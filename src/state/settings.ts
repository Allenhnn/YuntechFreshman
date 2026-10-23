export type ShadowQuality = 'off' | 'low' | 'high';

export interface Settings {
  /** Multiplier on the device pixel ratio (capped at 2). */
  renderScale: number;
  shadows: ShadowQuality;
  /** 0..1 */
  masterVolume: number;
  /** 0..1 */
  sfxVolume: number;
  /** Multiplier on CAMERA.sensitivity. */
  mouseSensitivity: number;
  invertY: boolean;
  showDebug: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  renderScale: 1,
  shadows: 'high',
  masterVolume: 0.8,
  sfxVolume: 0.8,
  mouseSensitivity: 1,
  invertY: false,
  showDebug: import.meta.env.DEV,
};

export const SETTINGS_LIMITS = {
  renderScale: { min: 0.5, max: 1, step: 0.05 },
  mouseSensitivity: { min: 0.2, max: 3, step: 0.1 },
} as const;

const STORAGE_KEY = 'yfm.settings.v1';

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const isShadow = (v: unknown): v is ShadowQuality => v === 'off' || v === 'low' || v === 'high';

/** Reads persisted settings field by field so a corrupt or outdated entry never breaks boot. */
export function loadSettings(): Settings {
  let raw: unknown = null;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    renderScale: num(r.renderScale, SETTINGS_LIMITS.renderScale.min, SETTINGS_LIMITS.renderScale.max, d.renderScale),
    shadows: isShadow(r.shadows) ? r.shadows : d.shadows,
    masterVolume: num(r.masterVolume, 0, 1, d.masterVolume),
    sfxVolume: num(r.sfxVolume, 0, 1, d.sfxVolume),
    mouseSensitivity: num(r.mouseSensitivity, SETTINGS_LIMITS.mouseSensitivity.min, SETTINGS_LIMITS.mouseSensitivity.max, d.mouseSensitivity),
    invertY: bool(r.invertY, d.invertY),
    showDebug: bool(r.showDebug, d.showDebug),
  };
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode, quota): settings simply don't persist.
  }
}
