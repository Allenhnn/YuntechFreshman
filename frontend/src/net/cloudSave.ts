import * as api from './authApi';
import type { AuthUser } from './authApi';
import { loadProgress, replaceProgress, saveListeners, type SaveData } from '../state/saveGame';
import { actions, gameStore, type SpawnPoint } from '../state/store';
import { storyActions, storyStore, type StoryProgress } from '../state/story';

/**
 * Keeps the signed-in account's progress on the server (backend/app/api/save.py).
 *
 * The game still plays from this browser's storage; this module mirrors it to the account:
 *   - on sign-in `pull()` fetches the account's save and writes it locally (or uploads local
 *     progress the first time, or when the local copy is newer than the server's);
 *   - every local change (autosave, pause, quit, best time, respawn point, new game) is uploaded a
 *     few seconds later, and once more with `keepalive` when the page closes.
 * Local progress remembers which account it belongs to, so another account signing in on the same
 * browser never inherits it.
 */
interface Payload {
  v: 1;
  /** Real time (ms) of the change; the newer copy wins when local and server differ. */
  savedAt: number;
  progress: SaveData | null;
  raceBest: number | null;
  customSpawn: SpawnPoint | null;
  /** Main story, side quests, achievements (state/story.ts). */
  story?: StoryProgress;
}

interface Meta {
  owner: string | null;
  savedAt: number;
}

const META_KEY = 'yfm.save.meta';
const UPLOAD_DELAY_MS = 3000;
/** The game autosaves every few seconds while playing; upload at most this often (pause/quit/close still flush). */
const MIN_UPLOAD_GAP_MS = 20_000;

const readMeta = (): Meta => {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as Partial<Meta> | null;
    return { owner: typeof m?.owner === 'string' ? m.owner : null, savedAt: typeof m?.savedAt === 'number' ? m.savedAt : 0 };
  } catch {
    return { owner: null, savedAt: 0 };
  }
};
const writeMeta = (m: Meta): void => {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ }
};

/** The account progress is mirrored to, or null (signed out / offline). */
let account: string | null = null;
let timer: number | undefined;
let uploading: Promise<void> | null = null;
let lastUpload = 0;

function snapshot(): Payload {
  const st = gameStore.getState();
  return { v: 1, savedAt: readMeta().savedAt || Date.now(), progress: loadProgress(), raceBest: st.raceBest, customSpawn: st.customSpawn, story: storyStore.getState().progress };
}

const hasAnything = (p: Payload): boolean => p.progress !== null || p.raceBest !== null || p.customSpawn !== null;

function parse(data: Record<string, unknown>): Payload | null {
  if (data.v !== 1) return null;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const spawn = data.customSpawn as SpawnPoint | null;
  return {
    v: 1,
    savedAt: finite(data.savedAt) ? data.savedAt : 0,
    progress: (data.progress as SaveData | null) ?? null,
    raceBest: finite(data.raceBest) ? data.raceBest : null,
    customSpawn: spawn && finite(spawn.x) && finite(spawn.z) && finite(spawn.facing) ? spawn : null,
    story: (data.story as StoryProgress | undefined) ?? undefined,
  };
}

/** Write the account's copy into this browser and the store. */
function applyLocally(p: Payload, owner: string): void {
  replaceProgress(p.progress);
  storyActions.replace(p.story ?? null);
  // loadProgress() validates what was written; a malformed server copy reads back as "no save".
  actions.applyAccountSave(p.raceBest, p.customSpawn);
  writeMeta({ owner, savedAt: p.savedAt });
}

async function upload(): Promise<void> {
  if (!account) return;
  const p = snapshot();
  lastUpload = Date.now();
  await api.putSave(p as unknown as Record<string, unknown>);
}

function flush(): void {
  window.clearTimeout(timer);
  timer = undefined;
  if (!account) return;
  uploading = (uploading ?? Promise.resolve())
    .then(upload)
    .catch(() => { timer ??= window.setTimeout(flush, 30_000); }) // server unreachable: retry later
    .finally(() => { uploading = null; });
}

saveListeners.add(() => {
  const meta = readMeta();
  writeMeta({ owner: account ?? meta.owner, savedAt: Date.now() });
  if (!account) return;
  const playing = gameStore.getState().phase === 'playing';
  if (playing && timer !== undefined) return; // an upload is already scheduled
  window.clearTimeout(timer);
  const wait = playing ? Math.max(UPLOAD_DELAY_MS, MIN_UPLOAD_GAP_MS - (Date.now() - lastUpload)) : UPLOAD_DELAY_MS;
  timer = window.setTimeout(flush, wait);
});

const onPageHide = (): void => {
  if (!account || timer === undefined) return;
  window.clearTimeout(timer);
  timer = undefined;
  api.putSaveOnUnload(snapshot() as unknown as Record<string, unknown>);
};
window.addEventListener('pagehide', onPageHide);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') onPageHide();
});

/** Sign-in: bring this browser in line with the account. Throws when the server can't be reached. */
export async function pull(user: AuthUser): Promise<void> {
  account = null;
  const remoteRaw = await api.getSave();
  const remote = remoteRaw ? parse(remoteRaw.data) : null;
  const meta = readMeta();
  const local = snapshot();
  // Local progress is this account's when it says so, or when it was made before any account was used here.
  const localIsMine = meta.owner === user.id || meta.owner === null;

  if (remote && !(localIsMine && hasAnything(local) && meta.savedAt > remote.savedAt)) {
    applyLocally(remote, user.id);
  } else if (localIsMine && hasAnything(local)) {
    writeMeta({ owner: user.id, savedAt: meta.savedAt || Date.now() });
    account = user.id;
    await upload();
  } else {
    // Someone else's progress, and this account has none yet: start fresh.
    applyLocally({ v: 1, savedAt: Date.now(), progress: null, raceBest: null, customSpawn: null }, user.id);
  }
  account = user.id;
}

/** Sign-out: upload what is pending, then stop mirroring. Local progress stays (it is tagged with its owner). */
export async function detach(): Promise<void> {
  if (account && timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
    await upload().catch(() => undefined);
  }
  await uploading;
  account = null;
}

/** Offline play: changes are kept locally and reconciled on the next sign-in. */
export function stop(): void {
  window.clearTimeout(timer);
  timer = undefined;
  account = null;
}
