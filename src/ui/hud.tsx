import { useEffect, useState, type ReactNode } from 'react';
import { HOTBAR_SIZE, ITEMS } from '../state/items';
import { TESTER_AVAILABLE, actions, useGame } from '../state/store';
import { useApi } from './api';
import { FullMap, Minimap } from './minimap';

const pad = (n: number): string => String(n).padStart(2, '0');

function partOfDay(hour: number): string {
  if (hour < 5) return '深夜';
  if (hour < 11) return '早上';
  if (hour < 13) return '中午';
  if (hour < 18) return '下午';
  return '晚上';
}

function Clock(): ReactNode {
  const minutes = useGame((s) => s.gameMinutes);
  const [real, setReal] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setReal(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const day = Math.floor(minutes / 1440) + 1;
  const hour = Math.floor((minutes % 1440) / 60);
  return (
    <div className="clock">
      <div className="time">{pad(hour)}:{pad(minutes % 60)}</div>
      <div className="sub">第 {day} 天 · {partOfDay(hour)} · 現實 {pad(real.getHours())}:{pad(real.getMinutes())}</div>
    </div>
  );
}

function Coins(): ReactNode {
  const coins = useGame((s) => s.coins);
  return (
    <div className="coins" aria-label={`新台幣 ${coins} 元`}>
      <span className="coin-icon">10</span>
      {/* key change restarts the bump animation on every pickup */}
      <span key={coins} className={coins > 0 ? 'bump' : ''}>NT$ {coins.toLocaleString('zh-TW')}</span>
    </div>
  );
}

function Hotbar(): ReactNode {
  const api = useApi();
  const slots = useGame((s) => s.inventory);
  const selected = useGame((s) => s.hotbarIndex);
  return (
    <div className="hotbar interactive">
      {slots.slice(0, HOTBAR_SIZE).map((stack, i) => (
        <button
          key={i}
          className={`slot${i === selected ? ' selected' : ''}`}
          title={stack ? ITEMS[stack.id].name : '空'}
          onClick={() => api.selectHotbar(i)}
        >
          <span className="num">{i + 1}</span>
          {stack && ITEMS[stack.id].icon}
          {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
        </button>
      ))}
    </div>
  );
}

function Toast(): ReactNode {
  const toast = useGame((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => actions.clearToast(toast.id), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);
  return toast ? <div key={toast.id} className="toast">{toast.text}</div> : null;
}

function RaceHud(): ReactNode {
  const api = useApi();
  const race = useGame((s) => s.race);
  const best = useGame((s) => s.raceBest);
  if (!race) return null;
  const leave = <button className="race-leave interactive" onClick={api.leaveRace}>✕ 離開計時賽 <kbd>Q</kbd></button>;
  if (race.phase === 'countdown') {
    return (
      <>
        <div className="race-hud">準備起跑{leave}</div>
        <div className="race-countdown" key={race.countdown}>{race.countdown}</div>
      </>
    );
  }
  return (
    <div className="race-hud">
      <b>{race.time.toFixed(1)}</b> 秒
      <span>檢查點 {race.gate}/{race.gates}</span>
      <span>{race.testing ? '不計成績' : `最佳 ${best === null ? '—' : best.toFixed(2)}`}</span>
      {leave}
    </div>
  );
}

/** Area title in the middle of the screen: fades in, holds, fades out (CSS), then clears. */
function AreaBannerView(): ReactNode {
  const banner = useGame((s) => s.areaBanner);
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => actions.clearArea(banner.id), 3000);
    return () => window.clearTimeout(t);
  }, [banner]);
  if (!banner) return null;
  return (
    <div className="area-banner" key={banner.id}>
      <div className="area-title">{banner.title}</div>
      <div className="area-rule" />
      {banner.subtitle && <div className="area-sub">{banner.subtitle}</div>}
    </div>
  );
}

function TesterBadge(): ReactNode {
  const t = useGame((s) => s.tester);
  if (!TESTER_AVAILABLE || !t.enabled) return null;
  const flag = (on: boolean): ReactNode => <span className={on ? 'on' : ''}>{on ? '開' : '關'}</span>;
  return (
    <div className="tester-badge">
      <b>🧪 測試員模式</b>　<kbd>F</kbd> 飛行 {flag(t.fly)}　<kbd>N</kbd> 穿牆 {flag(t.noclip)}　<kbd>+</kbd>/<kbd>-</kbd> 速度 <span className={t.speed > 1 ? 'on' : ''}>×{t.speed}</span>
      {t.fly && <>　<kbd>Space</kbd> 上升 <kbd>C</kbd> 下降</>}　<kbd>`</kbd> 關閉
    </div>
  );
}

export function Hud(): ReactNode {
  const api = useApi();
  const mapMode = useGame((s) => s.mapMode);
  const modal = useGame((s) => s.modal);
  const needsRelock = useGame((s) => s.needsRelock);
  return (
    <div className="hud">
      <Clock />
      <Coins />
      <TesterBadge />
      <RaceHud />
      <AreaBannerView />
      {mapMode === 'mini' && <Minimap />}
      {mapMode === 'mini' && <div className="osm-credit">© OpenStreetMap contributors</div>}
      <Hotbar />
      <button className="phone-btn interactive" aria-label="手機" onClick={() => api.toggleModal('phone')}>
        📱<kbd>P</kbd>
      </button>
      <div className="key-hints">
        <span><kbd>Tab</kbd>背包</span>
        <span><kbd>P</kbd>手機</span>
        <span><kbd>M</kbd>地圖</span>
      </div>
      {mapMode === 'full' && <FullMap />}
      {needsRelock && modal === 'none' && <div className="relock">點擊畫面以繼續控制視角</div>}
      <Toast />
    </div>
  );
}
