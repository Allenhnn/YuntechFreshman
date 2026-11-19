/**
 * Client for the FastAPI account service in backend/ (app/api/auth.py).
 *
 * In development Vite proxies `/api/*` to the backend (vite.config.ts), so the game and the API share an
 * origin and no CORS setup is needed. A deployed build can point elsewhere with VITE_API_BASE.
 * Tokens live in localStorage: a short-lived access token (JWT) and a rotating refresh token.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  is_guest: boolean;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

/** A request that reached the server and was refused; `status` is the HTTP status. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The server could not be reached at all (backend down, no network). */
export class OfflineError extends Error {}

const ACCESS = 'yfm.auth.access';
const REFRESH = 'yfm.auth.refresh';

const read = (k: string): string | null => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};

export const hasStoredSession = (): boolean => read(REFRESH) !== null;

function keep(t: TokenResponse): AuthUser {
  write(ACCESS, t.access_token);
  write(REFRESH, t.refresh_token);
  return t.user;
}

export function clearTokens(): void {
  write(ACCESS, null);
  write(REFRESH, null);
}

/** FastAPI errors carry `detail` as a string, or as a list of validation issues. */
function messageOf(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    const d = detail[0] as { loc?: unknown[]; msg?: string };
    const field = String(d.loc?.[d.loc.length - 1] ?? '');
    const name: Record<string, string> = { username: '使用者名稱', password: '密碼', display_name: '顯示名稱' };
    if (field === 'username') return '使用者名稱需為 3–20 個英文、數字或底線';
    if (field === 'password' && /least/.test(d.msg ?? '')) return '密碼至少需要 8 個字元';
    return `${name[field] ?? field}格式不正確`;
  }
  if (status >= 500) return '伺服器發生錯誤，請稍後再試';
  return `請求失敗（${status}）`;
}

async function request<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new OfflineError('連不上伺服器');
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  // Vite's proxy answers 502/503/504 with no JSON when the backend is not running; the backend's own errors carry `detail`.
  if ((res.status === 502 || res.status === 503 || res.status === 504) && !(data as { detail?: unknown } | null)?.detail) {
    throw new OfflineError('連不上伺服器');
  }
  if (!res.ok) throw new ApiError(res.status, messageOf(res.status, data));
  return data as T;
}

/** Calls an endpoint that needs the user; on 401 trades the refresh token for new ones and tries once more. */
async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await request<T>(method, path, body, read(ACCESS));
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !read(REFRESH)) throw e;
    await refresh();
    return request<T>(method, path, body, read(ACCESS));
  }
}

export async function refresh(): Promise<AuthUser> {
  const token = read(REFRESH);
  if (!token) throw new ApiError(401, '請先登入');
  try {
    return keep(await request<TokenResponse>('POST', '/auth/refresh', { refresh_token: token }));
  } catch (e) {
    if (e instanceof ApiError) clearTokens();
    throw e;
  }
}

export const me = (): Promise<AuthUser> => authed<AuthUser>('GET', '/auth/me');

export async function loginPassword(username: string, password: string): Promise<AuthUser> {
  return keep(await request<TokenResponse>('POST', '/auth/login', { username, password }));
}

export async function loginGuest(): Promise<AuthUser> {
  return keep(await request<TokenResponse>('POST', '/auth/guest'));
}

/** Throws ApiError 404 when this Google account has not registered yet. */
export async function loginGoogle(idToken: string): Promise<AuthUser> {
  return keep(await request<TokenResponse>('POST', '/auth/login/google', { id_token: idToken }));
}

/** Registers with Google plus a username and password. A signed-in guest is upgraded in place (same id). */
export async function registerGoogle(idToken: string, username: string, password: string, displayName?: string): Promise<AuthUser> {
  const body = { id_token: idToken, username, password, display_name: displayName || null };
  return keep(await request<TokenResponse>('POST', '/auth/register/google', body, read(ACCESS)));
}

export async function logout(): Promise<void> {
  const token = read(REFRESH);
  clearTokens();
  if (token) await request<void>('POST', '/auth/logout', { refresh_token: token }).catch(() => undefined);
}

export async function publicConfig(): Promise<{ google_client_id: string }> {
  return request('GET', '/auth/config');
}
