import { useEffect, useState, type ReactNode } from 'react';
import { actions, useGame } from '../state/store';
import { deletePhoto, listPhotos, type Photo } from '../state/album';
import { useApi } from './api';
import { SettingsPanel } from './menus';

interface AppSpec {
  id: string;
  label: string;
  icon: string;
  color: string;
  run?: () => void;
}

/** Album: thumbnails newest first; one opens full size with download and delete. */
function Album(): ReactNode {
  const api = useApi();
  const version = useGame((s) => s.albumVersion);
  const [photos, setPhotos] = useState<(Photo & { url: string })[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true, urls: string[] = [];
    void listPhotos().then((list) => {
      if (!live) return;
      const withUrls = list.map((p) => ({ ...p, url: URL.createObjectURL(p.blob) }));
      urls = withUrls.map((p) => p.url);
      setPhotos(withUrls);
    });
    return () => {
      live = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [version]);

  const current = photos?.find((p) => p.id === open) ?? null;
  if (current) {
    const download = (): void => {
      const a = document.createElement('a');
      const d = new Date(current.at);
      a.href = current.url;
      a.download = `雲寶寶_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.jpg`;
      a.click();
      api.click();
    };
    const remove = (): void => {
      void deletePhoto(current.id).then(() => {
        setOpen(null);
        actions.bumpAlbum();
      });
      api.click();
    };
    return (
      <div className="album-view">
        <img src={current.url} alt={current.label} />
        <div className="album-caption">{current.label}　{new Date(current.at).toLocaleString('zh-TW', { hour12: false })}</div>
        <div className="album-actions">
          <button className="btn small" onClick={() => { api.click(); setOpen(null); }}>返回</button>
          <button className="btn small" onClick={download}>下載</button>
          <button className="btn small danger" onClick={remove}>刪除</button>
        </div>
      </div>
    );
  }
  if (!photos) return <div className="desc">讀取中…</div>;
  if (!photos.length) return <div className="desc album-empty">還沒有照片。打開「相機」拍一張吧！</div>;
  return (
    <div className="album-grid">
      {photos.map((p) => (
        <button key={p.id} className="album-thumb" onClick={() => { api.click(); setOpen(p.id); }} title={p.label}>
          <img src={p.url} alt={p.label} />
        </button>
      ))}
    </div>
  );
}

export function PhoneDrawer(): ReactNode {
  const api = useApi();
  const minutes = useGame((s) => s.gameMinutes);
  const coins = useGame((s) => s.coins);
  const page = useGame((s) => s.phonePage);
  const setPage = (p: typeof page): void => {
    api.click();
    actions.setPhonePage(p);
  };
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
    { id: 'cam', label: '相機', icon: '📷', color: '#ffd9e0', run: api.openCamera },
    { id: 'album', label: '相簿', icon: '🖼️', color: '#fff1b8', run: () => setPage('album') },
    { id: 'settings', label: '設定', icon: '⚙️', color: '#e5e5e5', run: () => setPage('settings') },
    { id: 'home', label: '回出生點', icon: '🏠', color: '#d7f5dd', run: api.respawn },
    { id: 'msg', label: '訊息', icon: '💬', color: '#e8e0ff' },
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
              <h2 style={{ fontSize: 17 }}>{page === 'album' ? '相簿' : '設定'}</h2>
              <button className="btn small" onClick={() => setPage('home')}>返回</button>
            </div>
            {page === 'album' ? <Album /> : <SettingsPanel />}
          </div>
        )}
        <div style={{ flex: page === 'home' ? 1 : 0 }} />
        <div className="home-bar" />
      </div>
    </div>
  );
}
