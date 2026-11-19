import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { auth, authStore, useAuth } from '../state/auth';
import { useApi } from './api';
import { Brand } from './menus';

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
const gis = (): GoogleId | undefined =>
  (window as unknown as { google?: { accounts?: { id?: GoogleId } } }).google?.accounts?.id;

let gisLoading: Promise<boolean> | null = null;
/** Loads Google Identity Services once; resolves false when it is blocked or offline. */
function loadGis(): Promise<boolean> {
  if (gis()) return Promise.resolve(true);
  gisLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(!!gis());
    s.onerror = () => { gisLoading = null; resolve(false); };
    document.head.append(s);
  });
  return gisLoading;
}

/** The official Google button; `onCredential` receives the ID token. */
function GoogleButton({ text, onCredential }: { text: 'signin_with' | 'signup_with' | 'continue_with'; onCredential: (t: string) => void }): ReactNode {
  const clientId = useAuth((s) => s.googleClientId);
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [state, setState] = useState<'loading' | 'ready' | 'blocked'>('loading');
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    void loadGis().then((ok) => {
      const id = gis();
      if (!live) return;
      if (!ok || !id || !box.current) { setState('blocked'); return; }
      id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential) });
      box.current.replaceChildren();
      id.renderButton(box.current, { theme: 'outline', size: 'large', shape: 'pill', text, locale: 'zh-TW', width: 300 });
      setState('ready');
    });
    return () => { live = false; };
  }, [clientId, text]);
  if (!clientId) return <p className="login-note">伺服器尚未設定 Google 登入（GOOGLE_CLIENT_ID）</p>;
  return (
    <div className="google-slot">
      <div ref={box} />
      {state === 'loading' && <p className="login-note">正在載入 Google 登入…</p>}
      {state === 'blocked' && <p className="login-note">Google 登入元件載入失敗，請檢查網路或擴充功能</p>}
    </div>
  );
}

type Tab = 'login' | 'register';

export function LoginScreen(): ReactNode {
  const ui = useApi();
  const { busy, error, serverUp, upgrading, user } = useAuth((s) => s);
  const [tab, setTab] = useState<Tab>(upgrading ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  /** Google ID token waiting for a username and password (register step 2). */
  const [credential, setCredential] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [displayName, setDisplayName] = useState('');

  const switchTab = (t: Tab): void => {
    ui.click();
    setTab(t);
    auth.setError('');
  };
  const onLogin = (e: FormEvent): void => {
    e.preventDefault();
    if (!username.trim() || !password) { auth.setError('請輸入使用者名稱和密碼'); return; }
    ui.click();
    void auth.login(username, password);
  };
  const onGoogle = async (token: string): Promise<void> => {
    if (upgrading) { setCredential(token); return; }
    const r = await auth.google(token);
    if (r === 'new') {
      setCredential(token);
      setTab('register');
      auth.setError('');
    }
  };
  const onRegister = (e: FormEvent): void => {
    e.preventDefault();
    if (!credential) return;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(newName)) { auth.setError('使用者名稱需為 3–20 個英文、數字或底線'); return; }
    if (newPass.length < 8) { auth.setError('密碼至少需要 8 個字元'); return; }
    if (newPass !== newPass2) { auth.setError('兩次輸入的密碼不一樣'); return; }
    ui.click();
    void auth.register(credential, newName, newPass, displayName.trim() || undefined).then((ok) => {
      if (!ok && /過期|Google 驗證失敗/.test(authStore.getState().error)) setCredential(null);
    });
  };

  return (
    <div className="login-screen">
      <section className="login-card" aria-label="登入">
        <div className="login-hero">
          <Brand />
          <p className="tagline">走進校園，開始你的大學第一天</p>
          <ul className="login-perks">
            <li>☁️ 進度存在帳號，換電腦也能繼續</li>
            <li>🎒 背包、相簿、最佳紀錄跟著你走</li>
            <li>🚲 先用訪客玩，之後再綁 Google 也行</li>
          </ul>
        </div>

        <div className="login-form">
          {!serverUp ? (
            <div className="login-offline">
              <h2>連不上伺服器</h2>
              <p>帳號功能需要後端伺服器。你可以重試，或先離線遊玩（進度只存在這個瀏覽器）。</p>
              <button className="btn primary" onClick={() => { ui.click(); void auth.init(); }}>重新連線</button>
              <button className="btn" onClick={() => { ui.click(); auth.playOffline(); }}>離線遊玩</button>
            </div>
          ) : (
            <>
              {upgrading ? (
                <div className="login-upgrade-head">
                  <h2>綁定 Google 帳號</h2>
                  <p>{user?.display_name ?? '訪客'}的進度會保留，之後可用帳號密碼或 Google 登入。</p>
                </div>
              ) : (
                <div className="login-tabs" role="tablist">
                  <button role="tab" aria-selected={tab === 'login'} className={tab === 'login' ? 'on' : ''} onClick={() => switchTab('login')}>登入</button>
                  <button role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'on' : ''} onClick={() => switchTab('register')}>註冊</button>
                </div>
              )}

              {tab === 'login' && !upgrading && (
                <>
                  <form className="login-fields" onSubmit={onLogin}>
                    <label>
                      <span>使用者名稱</span>
                      <input value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoComplete="username" autoFocus maxLength={32} />
                    </label>
                    <label>
                      <span>密碼</span>
                      <input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" maxLength={128} />
                    </label>
                    <button className="btn primary" type="submit" disabled={busy}>{busy ? '登入中…' : '登入'}</button>
                  </form>
                  <div className="login-or"><span>或</span></div>
                  <GoogleButton text="signin_with" onCredential={(t) => void onGoogle(t)} />
                  <button className="btn guest" onClick={() => { ui.click(); void auth.guest(); }} disabled={busy}>
                    以訪客身分遊玩
                  </button>
                </>
              )}

              {tab === 'register' && (
                credential ? (
                  <form className="login-fields" onSubmit={onRegister}>
                    <p className="login-step">✅ 已通過 Google 驗證，請設定登入用的帳號密碼</p>
                    <label>
                      <span>使用者名稱</span>
                      <input value={newName} onChange={(e) => setNewName(e.currentTarget.value)} autoComplete="username" autoFocus maxLength={20} placeholder="3–20 個英文、數字或底線" />
                    </label>
                    <label>
                      <span>顯示名稱（選填）</span>
                      <input value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} maxLength={64} placeholder="預設用 Google 名稱" />
                    </label>
                    <label>
                      <span>密碼</span>
                      <input type="password" value={newPass} onChange={(e) => setNewPass(e.currentTarget.value)} autoComplete="new-password" maxLength={128} placeholder="至少 8 個字元" />
                    </label>
                    <label>
                      <span>確認密碼</span>
                      <input type="password" value={newPass2} onChange={(e) => setNewPass2(e.currentTarget.value)} autoComplete="new-password" maxLength={128} />
                    </label>
                    <button className="btn primary" type="submit" disabled={busy}>{busy ? '建立中…' : upgrading ? '綁定並保留進度' : '建立帳號'}</button>
                    <button className="btn link" type="button" onClick={() => { setCredential(null); auth.setError(''); }}>換一個 Google 帳號</button>
                  </form>
                ) : (
                  <div className="login-fields">
                    <p className="login-step">第 1 步：用 Google 驗證身分（我們只取得名稱、email 和頭像）</p>
                    <GoogleButton text="signup_with" onCredential={(t) => void onGoogle(t)} />
                    <p className="login-step muted">第 2 步：設定使用者名稱與密碼</p>
                  </div>
                )
              )}

              {upgrading && <button className="btn link" onClick={() => { ui.click(); auth.cancelUpgrade(); }}>先不要，回主選單</button>}
            </>
          )}
          <p className="login-error" role="alert">{error}</p>
        </div>
      </section>
      <p className="title-credit">核心原型 v0.7 · 國立雲林科技大學校園 · 地圖資料 © OpenStreetMap contributors</p>
    </div>
  );
}
