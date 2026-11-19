import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { auth, useAuth } from '../state/auth';
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

/** Google's own button (Google requires its button for sign-in), sized to its slot. */
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
      const el = box.current;
      if (!live) return;
      if (!ok || !id || !el) { setState('blocked'); return; }
      id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential) });
      el.replaceChildren();
      const width = Math.max(200, Math.min(400, Math.floor(el.clientWidth)));
      id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text, locale: 'zh-TW', width });
      setState('ready');
    });
    return () => { live = false; };
  }, [clientId, text]);
  if (!clientId) return <p className="login-note">伺服器尚未設定 Google 登入</p>;
  return (
    <div className="google-slot">
      <div ref={box} className="google-box" />
      {state === 'loading' && <p className="login-note">正在載入 Google 登入…</p>}
      {state === 'blocked' && <p className="login-note">Google 登入元件載入失敗</p>}
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
  const onRegister = (e: FormEvent): void => {
    e.preventDefault();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(newName)) { auth.setError('使用者名稱需為 3–20 個英文、數字或底線'); return; }
    if (/^guest_/i.test(newName)) { auth.setError('使用者名稱不能以 guest_ 開頭'); return; }
    if (newPass.length < 8) { auth.setError('密碼至少需要 8 個字元'); return; }
    if (newPass !== newPass2) { auth.setError('兩次輸入的密碼不一樣'); return; }
    ui.click();
    void auth.register(newName, newPass, displayName.trim() || undefined);
  };
  const onGoogle = (token: string): void => { void auth.google(token); };

  return (
    <div className="login-screen">
      <section className="login-card" aria-label="登入">
        <div className="login-hero">
          <Brand />
          <p className="tagline">走進校園，開始你的大學第一天</p>
          <ul className="login-perks">
            <li>☁️ 進度存在帳號，換電腦也能繼續</li>
            <li>🎒 背包、最佳紀錄、重生點跟著你走</li>
            <li>🚲 先用訪客玩，之後再註冊也能保留進度</li>
          </ul>
        </div>

        <div className="login-form">
          {!serverUp ? (
            <div className="login-offline">
              <h2>連不上伺服器</h2>
              <p>帳號功能需要後端伺服器。你可以重試，或先離線遊玩（進度只存在這個瀏覽器，下次登入時會同步到帳號）。</p>
              <button className="btn primary" onClick={() => { ui.click(); void auth.init(); }}>重新連線</button>
              <button className="btn" onClick={() => { ui.click(); auth.playOffline(); }}>離線遊玩</button>
            </div>
          ) : (
            <>
              {upgrading ? (
                <div className="login-upgrade-head">
                  <h2>註冊帳號並保留進度</h2>
                  <p>{user?.display_name ?? '訪客'}目前的進度會直接移到新帳號。</p>
                </div>
              ) : (
                <div className="login-tabs" role="tablist">
                  <button role="tab" aria-selected={tab === 'login'} className={tab === 'login' ? 'on' : ''} onClick={() => switchTab('login')}>登入</button>
                  <button role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'on' : ''} onClick={() => switchTab('register')}>註冊</button>
                </div>
              )}

              {tab === 'login' && !upgrading ? (
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
              ) : (
                <form className="login-fields" onSubmit={onRegister}>
                  <label>
                    <span>使用者名稱</span>
                    <input value={newName} onChange={(e) => setNewName(e.currentTarget.value)} autoComplete="username" autoFocus maxLength={20} placeholder="3–20 個英文、數字或底線" />
                  </label>
                  <label>
                    <span>顯示名稱（選填）</span>
                    <input value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} maxLength={64} placeholder="遊戲裡別人看到的名字" />
                  </label>
                  <div className="login-pair">
                    <label>
                      <span>密碼</span>
                      <input type="password" value={newPass} onChange={(e) => setNewPass(e.currentTarget.value)} autoComplete="new-password" maxLength={128} placeholder="至少 8 個字元" />
                    </label>
                    <label>
                      <span>確認密碼</span>
                      <input type="password" value={newPass2} onChange={(e) => setNewPass2(e.currentTarget.value)} autoComplete="new-password" maxLength={128} />
                    </label>
                  </div>
                  <button className="btn primary" type="submit" disabled={busy}>{busy ? '建立中…' : upgrading ? '註冊並保留進度' : '建立帳號'}</button>
                </form>
              )}

              <div className="login-or"><span>{tab === 'login' && !upgrading ? '或' : '或用 Google 帳號直接註冊'}</span></div>
              <div className="login-alt">
                <GoogleButton text={tab === 'login' && !upgrading ? 'signin_with' : 'signup_with'} onCredential={onGoogle} />
                {!upgrading && (
                  <button className="btn guest" onClick={() => { ui.click(); void auth.guest(); }} disabled={busy}>
                    以訪客身分遊玩
                  </button>
                )}
              </div>

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
