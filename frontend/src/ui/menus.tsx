import { useState, type ReactNode } from 'react';
import { SETTINGS_LIMITS, type Settings } from '../state/settings';
import { TESTER_AVAILABLE, useGame, actions } from '../state/store';
import { useApi } from './api';
import { auth, useAuth } from '../state/auth';
import { storyActions, useStory } from '../state/story';
import { dispatch } from '../state/commands';
import { StoryAdmin } from './story';
import { Icon, Rich } from './icons';

export function Brand(): ReactNode {
  return (
    <>
      <div className="leaf-row" aria-hidden>
        <i style={{ background: '#2e9e3e', transform: 'rotate(-20deg)' }} />
        <i style={{ background: '#2c6fd6', height: 30 }} />
        <i style={{ background: '#f2c230', transform: 'rotate(20deg)' }} />
      </div>
      <h1 className="title">
        雲寶寶上學趣
        <small>YUNBAOBAO GOES TO SCHOOL</small>
      </h1>
    </>
  );
}

export function LoadingScreen(): ReactNode {
  const progress = useGame((s) => s.loadProgress);
  return (
    <div className="screen">
      <div className="card">
        <Brand />
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
        <p className="footer">正在載入校園… {Math.round(progress * 100)}%</p>
      </div>
    </div>
  );
}

/** Shared by the main menu and the pause menu: root buttons, controls, settings. */
export function MenuScreen({ paused }: { paused: boolean }): ReactNode {
  const api = useApi();
  const panel = useGame((s) => s.menuPanel);
  const hint = useGame((s) => s.menuHint);
  const hasSave = useGame((s) => s.hasSave);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const account = useAuth((s) => s.status);
  const open = (p: 'root' | 'controls' | 'settings'): void => {
    api.click();
    actions.setMenuPanel(p);
  };

  if (panel === 'controls') {
    return (
      <div className="screen">
        <div className="card wide">
          <h2>操作介紹</h2>
          <ControlsTable />
          <button className="btn back" onClick={() => open('root')}>返回</button>
        </div>
      </div>
    );
  }
  if (panel === 'settings') {
    return (
      <div className="screen">
        <div className="card wide">
          <h2>設定</h2>
          <SettingsPanel />
          <button className="btn back" onClick={() => open('root')}>返回</button>
        </div>
      </div>
    );
  }
  if (!paused) {
    return (
      <div className="title-screen">
        <aside className="title-side">
          <Brand />
          <p className="tagline">走進校園，開始你的大學第一天</p>
          <nav className="title-menu">
            {confirmingNew ? (
              <div className="confirm-box">
                <p>確定要開始新遊戲嗎？目前的進度會被清除，無法復原。</p>
                <div>
                  <button className="btn primary" onClick={api.startGame}>清除進度並開始</button>
                  <button className="btn" onClick={() => setConfirmingNew(false)}>取消</button>
                </div>
              </div>
            ) : (
              <>
                {hasSave
                  ? <MenuItem primary icon="▶" label="繼續遊戲" sub="回到上次離開的地方" onClick={api.continueGame} />
                  : <MenuItem primary icon="▶" label="開始遊戲" sub="從宿舍區的道路出發" onClick={api.startGame} />}
                {hasSave && <MenuItem icon="✦" label="新遊戲" sub="清除進度重新開始" onClick={() => { api.click(); setConfirmingNew(true); }} />}
                <MenuItem icon="⌨" label="操作介紹" sub="移動、互動與快捷鍵" onClick={() => open('controls')} />
                <MenuItem icon="⚙" label="設定" sub="畫質、音量、滑鼠" onClick={() => open('settings')} />
              </>
            )}
          </nav>
          <p className="hint">{hint}</p>
          <p className="start-point"><Rich t={hasSave ? (account === 'signedIn' ? '☁️ 進度已同步到帳號' : '💾 進度已儲存在這個瀏覽器') : '📍 起點：宿舍區道路'} /></p>
        </aside>
        <PlayerCard />
        <p className="title-credit">核心原型 v0.7 · 國立雲林科技大學校園 · 地圖資料 © OpenStreetMap contributors</p>
      </div>
    );
  }
  return (
    <div className="screen">
      <div className="card">
        <h1 className="title">已暫停</h1>
        <div className="menu-buttons">
          <button className="btn primary" onClick={api.resume}>繼續遊戲</button>
          <button className="btn" onClick={() => open('controls')}>操作介紹</button>
          <button className="btn" onClick={() => open('settings')}>設定</button>
          <button className="btn" onClick={api.quitToMenu}>回主選單</button>
        </div>
        <p className="hint">{hint}</p>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, sub, primary, onClick }: { icon: string; label: string; sub: string; primary?: boolean; onClick: () => void }): ReactNode {
  return (
    <button className={`menu-item${primary ? ' primary' : ''}`} onClick={onClick}>
      <i aria-hidden><Rich t={icon} /></i>
      <span>
        <b>{label}</b>
        <small>{sub}</small>
      </span>
      <em aria-hidden>›</em>
    </button>
  );
}

/** Top-right account card on the title screen: who is playing, guest upgrade, sign out. */
function PlayerCard(): ReactNode {
  const api = useApi();
  const { status, user } = useAuth((s) => s);
  const [confirmOut, setConfirmOut] = useState(false);
  if (status === 'offline') {
    return (
      <div className="player-card">
        <div className="avatar"><Icon name="cloud" size={28} /></div>
        <div className="who">
          <b>離線遊玩</b>
          <small>進度只存在這個瀏覽器</small>
        </div>
        <button className="btn small" onClick={() => { api.click(); auth.backToLogin(); }}>登入</button>
      </div>
    );
  }
  if (!user) return null;
  if (confirmOut) {
    return (
      <div className="player-card confirm">
        <p>訪客登出後就無法再登入這個帳號，進度也會留在這台電腦上。要先註冊保留進度嗎？</p>
        <div className="player-actions">
          <button className="btn small primary" onClick={() => { api.click(); setConfirmOut(false); auth.startUpgrade(); }}>註冊帳號</button>
          <button className="btn small" onClick={() => { api.click(); setConfirmOut(false); void auth.logout(); }}>仍要登出</button>
          <button className="btn small" onClick={() => setConfirmOut(false)}>取消</button>
        </div>
      </div>
    );
  }
  const initial = [...(user.display_name || user.username)][0] ?? '?';
  return (
    <div className="player-card">
      {user.avatar_url
        ? <img className="avatar" src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
        : <div className="avatar">{initial}</div>}
      <div className="who">
        <b>{user.display_name}</b>
        <small>{user.is_guest ? '訪客帳號' : `@${user.username}`}</small>
      </div>
      <div className="player-actions">
        {user.is_guest && <button className="btn small primary" onClick={() => { api.click(); auth.startUpgrade(); }}>註冊帳號</button>}
        <button className="btn small" onClick={() => { api.click(); if (user.is_guest) setConfirmOut(true); else void auth.logout(); }}>登出</button>
      </div>
    </div>
  );
}

const CONTROLS: readonly [string, string][] = [
  ['W A S D', '移動（依相機方向）'],
  ['滑鼠', '旋轉視角'],
  ['Space', '跳躍（按越久跳越高）'],
  ['Shift', '衝刺'],
  ['Tab', '背包'],
  ['P', '手機'],
  ['M', '小地圖 / 全螢幕地圖'],
  ['1 – 5', '選擇快捷欄'],
  ['E', '互動（搭電梯、騎 / 下腳踏車）'],
  ['Enter', '對話框（輸入 /help 查看指令，/tester 切換管理員模式）'],
  ['Esc', '暫停 / 關閉視窗'],
  ...(TESTER_AVAILABLE ? [['`', '測試員模式：F 飛行、N 穿牆、+/- 速度'] as [string, string]] : []),
];

export function ControlsTable(): ReactNode {
  return (
    <div className="controls">
      {CONTROLS.map(([k, v]) => (
        <ControlRow key={k} keys={k} label={v} />
      ))}
    </div>
  );
}

function ControlRow({ keys, label }: { keys: string; label: string }): ReactNode {
  return (
    <>
      <kbd>{keys}</kbd>
      <span>{label}</span>
    </>
  );
}

export function SettingsPanel(): ReactNode {
  const api = useApi();
  const s = useGame((st) => st.settings);
  const tester = useGame((st) => st.tester);
  const ambient = useGame((st) => st.ambient);
  const storyOn = useStory((st) => st.enabled);
  const achievementsOn = useStory((st) => st.achievementsOn);
  const update = (patch: Partial<Settings>): void => api.updateSettings(patch);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  return (
    <div className="settings">
      <AccountSettings />
      <Slider label="畫面解析度" value={s.renderScale} {...SETTINGS_LIMITS.renderScale} format={pct} onChange={(v) => update({ renderScale: v })} />
      <div className="setting">
        <span>陰影品質</span>
        <div className="segmented">
          {(['off', 'low', 'high'] as const).map((q) => (
            <button key={q} className={s.shadows === q ? 'on' : ''} onClick={() => update({ shadows: q })}>
              {{ off: '關閉', low: '低', high: '高' }[q]}
            </button>
          ))}
        </div>
        <span />
      </div>
      <Slider label="主音量" value={s.masterVolume} min={0} max={1} step={0.05} format={pct} onChange={(v) => update({ masterVolume: v })} onCommit={api.click} />
      <Slider label="音效音量" value={s.sfxVolume} min={0} max={1} step={0.05} format={pct} onChange={(v) => update({ sfxVolume: v })} onCommit={api.click} />
      <Slider label="滑鼠靈敏度" value={s.mouseSensitivity} {...SETTINGS_LIMITS.mouseSensitivity} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => update({ mouseSensitivity: v })} />
      <Toggle label="反轉 Y 軸" value={s.invertY} onChange={(v) => update({ invertY: v })} />
      <Toggle label="除錯資訊" value={s.showDebug} onChange={(v) => update({ showDebug: v })} />
      {TESTER_AVAILABLE && <Toggle label="管理員模式（開發版）" value={tester.enabled} onChange={(v) => actions.setTester({ enabled: v })} />}
      {TESTER_AVAILABLE && tester.enabled && (
        <div className="admin-group">
          <Toggle label="校園行人、腳踏車" value={ambient.people} onChange={(v) => actions.setAmbient({ people: v })} />
          <Toggle label="道路機車、汽車" value={ambient.vehicles} onChange={(v) => actions.setAmbient({ vehicles: v })} />
          <Toggle label="劇情（主線、支線）" value={storyOn} onChange={(v) => storyActions.setConfig({ enabled: v })} />
          <Toggle label="成就" value={achievementsOn} onChange={(v) => storyActions.setConfig({ achievementsOn: v })} />
          <StoryAdmin
            onJump={(day, step) => { api.click(); dispatch({ type: 'storyAdmin', op: 'jump', day, step }); }}
            onComplete={() => { api.click(); dispatch({ type: 'storyAdmin', op: 'complete' }); }}
            onReset={() => { api.click(); dispatch({ type: 'storyAdmin', op: 'reset' }); }}
          />
        </div>
      )}
    </div>
  );
}

/** 設定 → 帳號: rename the display name (everyone) and the username (registered accounts). */
function AccountSettings(): ReactNode {
  const api = useApi();
  const user = useAuth((s) => s.user);
  const status = useAuth((s) => s.status);
  const [name, setName] = useState(user?.display_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user || status !== 'signedIn') return null;
  const dirty = name.trim() !== user.display_name || (!user.is_guest && username.toLowerCase() !== user.username);
  const save = async (): Promise<void> => {
    if (!name.trim()) { setMsg({ ok: false, text: '顯示名稱不能空白' }); return; }
    if (!user.is_guest && !/^[A-Za-z0-9_]{3,20}$/.test(username)) { setMsg({ ok: false, text: '使用者名稱需為 3–20 個英文、數字或底線' }); return; }
    api.click();
    setBusy(true);
    const patch: { display_name?: string; username?: string } = {};
    if (name.trim() !== user.display_name) patch.display_name = name.trim();
    if (!user.is_guest && username.toLowerCase() !== user.username) patch.username = username;
    const err = await auth.rename(patch);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: '已更新' });
    if (!err) setUsername((u) => u.toLowerCase());
  };
  return (
    <div className="account-settings">
      <div className="setting">
        <span>顯示名稱</span>
        <input className="text-input" value={name} maxLength={64} onChange={(e) => { setName(e.currentTarget.value); setMsg(null); }} />
        <span />
      </div>
      <div className="setting">
        <span>使用者名稱</span>
        {user.is_guest
          ? <span className="muted">訪客帳號，註冊後才能設定</span>
          : <input className="text-input" value={username} maxLength={20} onChange={(e) => { setUsername(e.currentTarget.value); setMsg(null); }} />}
        <span />
      </div>
      <div className="account-save">
        <span className={msg ? (msg.ok ? 'ok' : 'err') : ''}>{msg?.text ?? (user.has_password ? '' : user.is_guest ? '' : '此帳號用 Google 登入')}</span>
        <button className="btn small primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存名稱'}</button>
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: () => void;
}

function Slider({ label, value, min, max, step, format, onChange, onCommit }: SliderProps): ReactNode {
  return (
    <label className="setting">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        onPointerUp={onCommit}
      />
      <span className="value">{format(value)}</span>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): ReactNode {
  return (
    <div className="setting">
      <span>{label}</span>
      <span>
        <button className={`switch${value ? ' on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)} />
      </span>
      <span />
    </div>
  );
}
