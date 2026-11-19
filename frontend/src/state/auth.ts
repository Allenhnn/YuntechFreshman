import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import * as api from '../net/authApi';
import type { AuthUser } from '../net/authApi';
import * as cloud from '../net/cloudSave';

/**
 * Account state for the title screens.
 *   checking  → looking for a stored session (runs while the campus loads)
 *   signedOut → the login screen is shown
 *   signedIn  → the main menu is shown, with the player card; progress is mirrored to the account
 *   offline   → the player chose to play without the server (progress stays in this browser)
 */
export type AuthStatus = 'checking' | 'signedOut' | 'signedIn' | 'offline';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** The server answered at least once this session. */
  serverUp: boolean;
  /** Google Identity Services client id from GET /auth/config ('' when the server has none). */
  googleClientId: string;
  busy: boolean;
  error: string;
  /** Login screen opened from a guest's menu to register (upgrade) instead of sign in. */
  upgrading: boolean;
}

export const authStore = createStore<AuthState>()(() => ({
  status: 'checking',
  user: null,
  serverUp: false,
  googleClientId: '',
  busy: false,
  error: '',
  upgrading: false,
}));

export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useStore(authStore, selector);
}

const set = authStore.setState;

export const errorText = (e: unknown): string =>
  e instanceof api.OfflineError ? '連不上伺服器，請確認後端已啟動（backend/：uv run python -m app.main）'
  : e instanceof Error ? e.message : '發生未知錯誤';

/** Signs in with `task`, then brings the account's saved progress into this browser. */
async function run(task: () => Promise<AuthUser>): Promise<boolean> {
  set({ busy: true, error: '' });
  try {
    const user = await task();
    await cloud.pull(user);
    set({ status: 'signedIn', user, busy: false, serverUp: true, upgrading: false });
    return true;
  } catch (e) {
    set({ busy: false, error: errorText(e), serverUp: !(e instanceof api.OfflineError) });
    return false;
  }
}

export const auth = {
  /** Fetch the public config and resume a stored session, if any. */
  async init(): Promise<void> {
    set({ status: 'checking', error: '' });
    try {
      const cfg = await api.publicConfig();
      set({ serverUp: true, googleClientId: cfg.google_client_id ?? '' });
    } catch (e) {
      set({ serverUp: false, status: 'signedOut', error: e instanceof api.OfflineError ? '' : errorText(e) });
      return;
    }
    if (!api.hasStoredSession()) {
      set({ status: 'signedOut' });
      return;
    }
    try {
      const user = await api.me();
      await cloud.pull(user);
      set({ status: 'signedIn', user });
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) api.clearTokens();
      set({ status: 'signedOut', user: null, error: e instanceof api.ApiError && e.status === 401 ? '' : errorText(e) });
    }
  },
  login: (username: string, password: string) => run(() => api.loginPassword(username, password)),
  guest: () => run(api.loginGuest),
  /** Google sign-in; a first-time Google account is registered and signed in. While upgrading, it upgrades the guest. */
  google: (idToken: string) => run(() => api.loginGoogle(idToken, authStore.getState().upgrading)),
  /** Username + password registration; while upgrading, the guest becomes this account. */
  register: (username: string, password: string, displayName?: string) =>
    run(() => api.register(username, password, displayName, authStore.getState().upgrading)),
  async logout(): Promise<void> {
    await cloud.detach();
    await api.logout();
    set({ status: 'signedOut', user: null, error: '', upgrading: false });
  },
  /** Settings: rename. Resolves to an error message, or '' on success. */
  async rename(patch: { display_name?: string; username?: string }): Promise<string> {
    try {
      set({ user: await api.updateMe(patch) });
      return '';
    } catch (e) {
      return errorText(e);
    }
  },
  /** A guest asks to keep their progress: show the register form (their token upgrades the same account). */
  startUpgrade(): void {
    set({ status: 'signedOut', upgrading: true, error: '' });
  },
  cancelUpgrade(): void {
    set({ status: authStore.getState().user ? 'signedIn' : 'signedOut', upgrading: false, error: '' });
  },
  playOffline(): void {
    cloud.stop();
    set({ status: 'offline', error: '' });
  },
  backToLogin(): void {
    set({ status: 'signedOut', error: '' });
  },
  setError(error: string): void {
    set({ error });
  },
};
