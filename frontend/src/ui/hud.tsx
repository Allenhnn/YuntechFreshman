import { useEffect, type ReactNode } from 'react';
import { useStory } from '../state/story';
import { HOTBAR_SIZE, ITEMS } from '../state/items';
import { actions, useGame } from '../state/store';
import { ChatLog } from './chat';
import { useApi } from './api';
import { FullMap, Minimap } from './minimap';
import { PhoneNotice } from './phone';
import { Icon, Rich } from './icons';

function Coins(): ReactNode {
  const coins = useGame((s) => s.coins);
  return (
    <div className="coins" aria-label={`新台幣 ${coins} 元`}>
      <span className="coin-icon" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}textures/coin/reverse.png)` }} />
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
          {stack && <Rich t={ITEMS[stack.id].icon} />}
          {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
        </button>
      ))}
    </div>
  );
}

function Toast(): ReactNode {
  const toast = useGame((s) => s.toast);
  // The story countdown sits at the top centre too: messages go just below it.
  const countdown = useStory((s) => !!s.live.countdown);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => actions.clearToast(toast.id), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);
  return toast ? <div key={toast.id} className={`toast${countdown ? ' below-cd' : ''}`}><Rich t={toast.text} /></div> : null;
}

function RaceHud(): ReactNode {
  const api = useApi();
  const race = useGame((s) => s.race);
  const best = useGame((s) => s.raceBest);
  if (!race) return null;
  const leave = <button className="race-leave interactive" onClick={api.leaveRace}><Icon name="close" /> 離開計時賽 <kbd>Q</kbd></button>;
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
      {race.rival && <span>對手 阿凱 {race.rival.toFixed(1)} 秒</span>}
      {leave}
    </div>
  );
}

/** Navigation bar under the top edge: goal, distance left, walking time, end button. */
function NavBar(): ReactNode {
  const api = useApi();
  const nav = useGame((s) => s.nav);
  const racing = useGame((s) => s.race !== null);
  if (!nav) return null;
  const m = Math.round(nav.remaining);
  const secs = Math.max(1, Math.round(nav.remaining / 3.5));
  const eta = secs < 60 ? `${secs} 秒` : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
  return (
    <div className={`nav-bar${racing ? ' lower' : ''}`}>
      <span className="nav-icon"><Icon name="compass" size={22} /></span>
      <span className="nav-goal">{nav.name}</span>
      <span className="nav-dist">{m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`}</span>
      <span className="nav-eta">步行約 {eta}</span>
      <button className="nav-stop interactive" onClick={api.stopNav}>結束 <kbd>X</kbd></button>
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
  if (!t.enabled) return null;
  const flag = (on: boolean): ReactNode => <span className={on ? 'on' : ''}>{on ? '開' : '關'}</span>;
  return (
    <div className="tester-badge">
      <b><Icon name="flask" /> 測試員模式</b>　<kbd>F</kbd> 飛行 {flag(t.fly)}　<kbd>N</kbd> 穿牆 {flag(t.noclip)}　<kbd>+</kbd>/<kbd>-</kbd> 速度 <span className={t.speed > 1 ? 'on' : ''}>×{t.speed}</span>
      {t.fly && <>　<kbd>Space</kbd> 上升 <kbd>C</kbd> 下降</>}　<kbd>/tester</kbd> 關閉
    </div>
  );
}

function SportPanel(): ReactNode {
  const s = useGame((st) => st.sport);
  if (!s) return null;
  return (
    <>
    {s.fp && <div className="crosshair"><i /><b /></div>}
    <div className={`sport-hud${s.fp ? ' big' : ''}`}>
      <div className="sport-head"><b><Rich t={s.title} /></b><span className="sport-score">{s.score}</span></div>
      {s.vs && <div className="sport-vs"><span>你 <b>{s.vs.you}</b></span><i>VS</i><span><b>{s.vs.them}</b> {s.vs.name}</span></div>}
      <div className="sport-info">{s.info}　最佳 {s.best}</div>
      {s.charge !== null && (
        <div className="sport-meter">
          {s.sweet && <div className="sweet" style={{ left: `${s.sweet[0] * 100}%`, width: `${(s.sweet[1] - s.sweet[0]) * 100}%` }} />}
          <div className="fill" style={{ width: `${s.charge * 100}%` }} />
        </div>
      )}
      {s.message && <div className="sport-msg" key={s.message}><Rich t={s.message} /></div>}
      <div className="sport-hint">{s.hint}</div>
    </div>
    </>
  );
}

export function Hud(): ReactNode {
  const api = useApi();
  const mapMode = useGame((s) => s.mapMode);
  const modal = useGame((s) => s.modal);
  const needsRelock = useGame((s) => s.needsRelock);
  return (
    <div className="hud">
      <Coins />
      <TesterBadge />
      <SportPanel />
      <RaceHud />
      <AreaBannerView />
      <PhoneNotice />
      <NavBar />
      {mapMode === 'mini' && <Minimap />}
      {mapMode === 'mini' && <div className="osm-credit">© OpenStreetMap contributors</div>}
      <Hotbar />
      <button className="phone-btn interactive" aria-label="手機" onClick={() => api.toggleModal('phone')}>
        <Icon name="phone" size={30} /><kbd>P</kbd>
      </button>
      <div className="key-hints">
        <span><kbd>Tab</kbd>背包</span>
        <span><kbd>P</kbd>手機</span>
        <span><kbd>M</kbd>地圖</span>
        <span><kbd>J</kbd>任務</span>
        <span><kbd>Enter</kbd>對話</span>
      </div>
      <ChatLog />
      {mapMode === 'full' && <FullMap />}
      {needsRelock && modal === 'none' && <div className="relock">點擊畫面以繼續控制視角</div>}
      <Toast />
    </div>
  );
}
