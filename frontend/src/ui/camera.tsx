import { useEffect, useRef, useState, type ReactNode } from 'react';
import { listPhotos } from '../state/album';
import { useGame } from '../state/store';
import { useStory } from '../state/story';
import { useApi } from './api';

/**
 * Phone camera mode overlay: drag anywhere to turn, shutter (or Space), flip lens (or R), album
 * shortcut showing the last photo, Esc / ✕ to put the phone away.
 */
export function CameraOverlay(): ReactNode {
  const api = useApi();
  const selfie = useGame((s) => s.cameraSelfie);
  const albumVersion = useGame((s) => s.albumVersion);
  const photoSpot = useStory((s) => s.live.photoSpot);
  const [flash, setFlash] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Last photo for the album button.
  useEffect(() => {
    let url: string | null = null, live = true;
    void listPhotos().then((p) => {
      if (!live || !p[0]) return;
      url = URL.createObjectURL(p[0].blob);
      setThumb(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [albumVersion]);

  const shoot = (): void => {
    api.takePhoto();
    setFlash((n) => n + 1);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        shoot();
      } else if (e.code === 'KeyR') {
        api.flipCamera();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div
      className="camera-mode"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        api.cameraLook(e.clientX - d.x, e.clientY - d.y);
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (drag.current = null)}
    >
      {photoSpot && <div className="photo-spot">📸 打卡點：{photoSpot}　按快門打卡！</div>}
      {flash > 0 && <div key={flash} className="camera-flash" />}
      <div className="camera-top">
        <span className="camera-mode-name">{selfie ? '🤳 自拍' : '📷 拍照'}</span>
        <span className="camera-hint">拖曳畫面轉視角 · <kbd>Space</kbd> 拍照 · <kbd>R</kbd> 切換鏡頭 · <kbd>Esc</kbd> 離開</span>
        <button className="camera-close" aria-label="離開相機" onClick={api.closeModal}>✕</button>
      </div>
      <div className="camera-bar">
        <button className="camera-album" aria-label="相簿" onClick={api.openAlbum}>
          {thumb ? <img src={thumb} alt="" /> : <span>🖼️</span>}
        </button>
        <button className="camera-shutter" aria-label="拍照" onClick={shoot} />
        <button className="camera-flip" aria-label="切換鏡頭" onClick={api.flipCamera}>🔄</button>
      </div>
    </div>
  );
}
