import { useState, type ReactNode } from 'react';
import { SETTINGS_LIMITS, type Settings } from '../state/settings';
import { TESTER_AVAILABLE, useGame, actions } from '../state/store';
import { useApi } from './api';

function Brand(): ReactNode {
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
        <aside className="title-panel">
          <Brand />
          <p className="tagline">走進校園，開始你的大學第一天</p>
          <div className="title-actions">
            {confirmingNew ? (
              <>
                <p className="confirm-new">確定要開始新遊戲嗎？目前的進度會被清除，無法復原。</p>
                <button className="btn primary" onClick={api.startGame}>清除進度並開始</button>
                <button className="btn" onClick={() => setConfirmingNew(false)}>取消</button>
              </>
            ) : (
              <>
                {hasSave
                  ? <button className="btn primary" onClick={api.continueGame}>繼續遊戲</button>
                  : <button className="btn primary" onClick={api.startGame}>開始遊戲</button>}
                {hasSave && <button className="btn" onClick={() => { api.click(); setConfirmingNew(true); }}>新遊戲</button>}
                <button className="btn" onClick={() => open('controls')}>操作介紹</button>
                <button className="btn" onClick={() => open('settings')}>設定</button>
              </>
            )}
          </div>
          <p className="hint">{hint}</p>
          <p className="start-point">{hasSave ? '💾 進度已儲存在這個瀏覽器' : '📍 起點：學生宿舍C 中庭'}</p>
        </aside>
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
  ['Enter', '對話框（輸入 /help 查看指令，/tester 切換測試員模式）'],
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
  const update = (patch: Partial<Settings>): void => api.updateSettings(patch);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  return (
    <div className="settings">
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
      {TESTER_AVAILABLE && <Toggle label="測試員模式（開發版）" value={tester.enabled} onChange={(v) => actions.setTester({ enabled: v })} />}
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
