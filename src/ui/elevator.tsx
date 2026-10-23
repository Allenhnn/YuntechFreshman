import type { ReactNode } from 'react';
import { useGame } from '../state/store';
import { useApi } from './api';

export function ElevatorModal(): ReactNode {
  const api = useApi();
  const menu = useGame((s) => s.elevator);
  if (!menu) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && api.closeModal()}>
      <div className="card elevator">
        <div className="modal-head">
          <h2>電梯 · {menu.title}</h2>
          <button className="close-x" aria-label="關閉" onClick={api.closeModal}>✕</button>
        </div>
        <div className="floor-buttons">
          {menu.levels.map((l) => (
            <button
              key={l.id}
              className={`floor-btn${l.id === menu.current ? ' current' : ''}`}
              disabled={!l.enabled}
              title={l.note}
              onClick={() => api.elevatorTo(l.id)}
            >
              <span className="lv">{l.id}</span>
              <span className="note">{l.note}</span>
            </button>
          ))}
        </div>
        <p className="footer">灰色樓層尚在建置中 · <kbd>Esc</kbd> 關閉</p>
      </div>
    </div>
  );
}

export function InteractPrompt(): ReactNode {
  const prompt = useGame((s) => s.interactPrompt);
  const modal = useGame((s) => s.modal);
  if (!prompt || modal !== 'none') return null;
  return (
    <div className="interact-prompt">
      <kbd>E</kbd> {prompt.replace(/^按 E /, '')}
    </div>
  );
}

export function Fade(): ReactNode {
  const fading = useGame((s) => s.fading);
  return <div className={`fade${fading ? ' on' : ''}`} />;
}
