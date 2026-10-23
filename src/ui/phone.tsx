import { useState, type ReactNode } from 'react';
import { useGame } from '../state/store';
import { useApi } from './api';
import { SettingsPanel } from './menus';

type Page = 'home' | 'settings';

interface AppSpec {
  id: string;
  label: string;
  icon: string;
  color: string;
  run?: () => void;
}

export function PhoneDrawer(): ReactNode {
  const api = useApi();
  const minutes = useGame((s) => s.gameMinutes);
  const coins = useGame((s) => s.coins);
  const [page, setPage] = useState<Page>('home');
  const hh = String(Math.floor((minutes % 1440) / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');

  const apps: AppSpec[] = [
    {
      id: 'map', label: '地圖', icon: '🗺️', color: '#cfe8ff',
      run: () => {
        api.closeModal();
        api.toggleMap();
      },
    },
    { id: 'bag', label: '背包', icon: '🎒', color: '#ffe3c2', run: () => api.toggleModal('inventory') },
    { id: 'settings', label: '設定', icon: '⚙️', color: '#e5e5e5', run: () => { api.click(); setPage('settings'); } },
    { id: 'home', label: '回出生點', icon: '🏠', color: '#d7f5dd', run: api.respawn },
    { id: 'msg', label: '訊息', icon: '💬', color: '#e8e0ff' },
    { id: 'cam', label: '相機', icon: '📷', color: '#ffd9e0' },
  ];

  return (
    <div className="phone" role="dialog" aria-label="手機">
      <div className="screen-inner">
        <div className="notch" />
        <div className="statusbar">
          <span>{hh}:{mm}</span>
          <span>NT$ {coins} · 📶 🔋</span>
        </div>
        {page === 'home' ? (
          <div className="apps">
            {apps.map((a) => (
              <button key={a.id} className="app" disabled={!a.run} onClick={a.run} title={a.run ? a.label : '即將推出'}>
                <span className="ico" style={{ background: a.color }}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="page">
            <div className="modal-head">
              <h2 style={{ fontSize: 17 }}>設定</h2>
              <button className="btn small" onClick={() => { api.click(); setPage('home'); }}>返回</button>
            </div>
            <SettingsPanel />
          </div>
        )}
        <div style={{ flex: page === 'home' ? 1 : 0 }} />
        <div className="home-bar" />
      </div>
    </div>
  );
}
