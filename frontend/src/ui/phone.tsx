import { useEffect, useRef, useState, type ReactNode } from 'react';
import { actions, useGame } from '../state/store';
import { storyActions, useStory } from '../state/story';
import { storyEvents } from '../story/storyRuntime';
import { FRIEND, ROOMMATE } from '../story/storyData';
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

const AVATAR: Record<string, string> = { [ROOMMATE]: '🧑🏻', [FRIEND]: '👩🏻' };

/** 聊天室: threads, then one thread with bubbles and the quick replies the story offers. */
function Chat(): ReactNode {
  const api = useApi();
  const phone = useStory((s) => s.phone);
  const [open, setOpen] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const names = [...new Set([ROOMMATE, FRIEND, ...Object.keys(phone.threads)])];
  useEffect(() => { if (open) storyActions.readThread(open); }, [open, phone.threads]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [open, phone.threads]);
  if (open) {
    const msgs = phone.threads[open] ?? [];
    const replies = phone.replies[open] ?? [];
    return (
      <div className="chat-thread">
        <div className="chat-head"><button className="btn small" onClick={() => { api.click(); setOpen(null); }}>‹</button><b>{AVATAR[open] ?? '🙂'} {open}</b></div>
        <div className="chat-msgs">
          {!msgs.length && <div className="desc">還沒有訊息</div>}
          {msgs.map((m, i) => <div key={i} className={`bubble${m.me ? ' me' : ''}`}>{m.text}</div>)}
          <div ref={end} />
        </div>
        <div className="chat-replies">
          {replies.length ? replies.map((r) => <button key={r.id} className="btn small" onClick={() => { api.click(); storyEvents.chat(open, r.id); }}>{r.text}</button>)
            : <span className="desc">（沒有可以回的話）</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="chat-list">
      {names.map((n) => {
        const msgs = phone.threads[n] ?? [];
        const lastMsg = msgs[msgs.length - 1];
        return (
          <button key={n} className="chat-row" onClick={() => { api.click(); setOpen(n); }}>
            <i>{AVATAR[n] ?? '🙂'}</i>
            <span><b>{n}</b><small>{lastMsg ? lastMsg.text : '（沒有訊息）'}</small></span>
            {(phone.unread[n] ?? 0) > 0 && <em>{phone.unread[n]}</em>}
          </button>
        );
      })}
    </div>
  );
}

/** 點名系統: a 4-digit keypad for the open digital roll call. */
function Rollcall(): ReactNode {
  const api = useApi();
  const rc = useStory((s) => s.phone.rollcall);
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'ok' | 'bad'>('idle');
  const press = (k: string): void => {
    api.click();
    setState('idle');
    if (k === '⌫') setCode((c) => c.slice(0, -1));
    else if (code.length < 4) setCode((c) => c + k);
  };
  const submit = (): void => {
    if (code.length !== 4) return;
    if (storyEvents.rollcallCode(code)) { setState('ok'); actions.toast('✅ 數位點名簽到成功'); }
    else { setState('bad'); setCode(''); }
  };
  if (!rc && state !== 'ok') return <div className="desc rc-none">目前沒有進行中的點名 ✅</div>;
  return (
    <div className="rc">
      <div className="rc-course">{rc?.course ?? '已簽到'}</div>
      {state === 'ok' ? <div className="rc-ok">✅ 簽到成功！</div> : (
        <>
          <div className={`rc-code${state === 'bad' ? ' bad' : ''}`}>{[0, 1, 2, 3].map((i) => <span key={i}>{code[i] ?? ''}</span>)}</div>
          <div className="rc-msg">{state === 'bad' ? '❌ 點名碼錯誤，請重試' : '輸入 4 位數點名碼'}</div>
          <div className="rc-keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
              <button key={k} className={k === '✓' ? 'go' : ''} disabled={k === '✓' && code.length !== 4} onClick={() => (k === '✓' ? submit() : press(k))}>{k}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Newest phone message as a banner at the top of the screen for a few seconds. */
export function PhoneNotice(): ReactNode {
  const api = useApi();
  const note = useStory((s) => s.phone.note);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!note) return;
    setShown(note.at);
    const t = window.setTimeout(() => setShown(null), 5000);
    return () => window.clearTimeout(t);
  }, [note]);
  if (!note || shown !== note.at) return null;
  return (
    <button className="phone-notice interactive" key={note.at} onClick={() => { api.click(); actions.setPhonePage('chat'); api.toggleModal('phone'); }}>
      <i>{AVATAR[note.from] ?? '💬'}</i>
      <span><b>{note.from}</b><small>{note.text}</small></span>
      <em>按 P 查看</em>
    </button>
  );
}

export function PhoneDrawer(): ReactNode {
  const api = useApi();
  const minutes = useGame((s) => s.gameMinutes);
  const page = useGame((s) => s.phonePage);
  const unread = useStory((s) => Object.values(s.phone.unread).reduce((a, b) => a + b, 0));
  const rcOpen = useStory((s) => !!s.phone.rollcall);
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
    { id: 'msg', label: '聊天室', icon: '💬', color: '#e8e0ff', run: () => setPage('chat') },
    { id: 'rollcall', label: '點名系統', icon: '✅', color: '#d6f0ff', run: () => setPage('rollcall') },
  ];

  return (
    <div className="phone" role="dialog" aria-label="手機">
      <div className="screen-inner">
        <div className="notch" />
        <div className="statusbar">
          <span>{hh}:{mm}</span>
          <span>📶 🔋</span>
        </div>
        {page === 'home' ? (
          <div className="apps">
            {apps.map((a) => (
              <button key={a.id} className="app" disabled={!a.run} onClick={a.run} title={a.run ? a.label : '即將推出'}>
                <span className="ico" style={{ background: a.color }}>{a.icon}{a.id === 'msg' && unread > 0 && <em className="badge">{unread}</em>}{a.id === 'rollcall' && rcOpen && <em className="badge">!</em>}</span>
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="page">
            <div className="modal-head">
              <h2 style={{ fontSize: 17 }}>{page === 'album' ? '相簿' : page === 'chat' ? '聊天室' : page === 'rollcall' ? '點名系統' : '設定'}</h2>
              <button className="btn small" onClick={() => setPage('home')}>返回</button>
            </div>
            {page === 'album' ? <Album /> : page === 'chat' ? <Chat /> : page === 'rollcall' ? <Rollcall /> : <SettingsPanel />}
          </div>
        )}
        <div style={{ flex: page === 'home' ? 1 : 0 }} />
        <div className="home-bar" />
      </div>
    </div>
  );
}
