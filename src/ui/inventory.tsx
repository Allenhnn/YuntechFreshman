import { useState, type ReactNode } from 'react';
import { HOTBAR_SIZE, ITEMS } from '../state/items';
import { useGame } from '../state/store';
import { useApi } from './api';

export function InventoryModal(): ReactNode {
  const api = useApi();
  const slots = useGame((s) => s.inventory);
  const held = useGame((s) => s.heldSlot);
  const hotbar = useGame((s) => s.hotbarIndex);
  const [focus, setFocus] = useState<number>(hotbar);
  const focused = slots[focus] ?? null;
  const def = focused ? ITEMS[focused.id] : null;

  const cells: ReactNode[] = [];
  slots.forEach((stack, i) => {
    if (i === 0) cells.push(<div key="l0" className="row-label">快捷欄（1–5）</div>);
    if (i === HOTBAR_SIZE) cells.push(<div key="l1" className="row-label">背包</div>);
    const cls = ['slot', i === focus ? 'selected' : '', i === held ? 'held' : ''].filter(Boolean).join(' ');
    cells.push(
      <button
        key={i}
        className={cls}
        onMouseEnter={() => setFocus(i)}
        onClick={() => {
          setFocus(i);
          api.clickSlot(i);
        }}
      >
        {i < HOTBAR_SIZE && <span className="num">{i + 1}</span>}
        {stack && ITEMS[stack.id].icon}
        {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
      </button>,
    );
  });

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && api.closeModal()}>
      <div className="card wide" style={{ width: 'auto' }}>
        <div className="modal-head">
          <h2>背包</h2>
          <button className="close-x" aria-label="關閉" onClick={api.closeModal}>✕</button>
        </div>
        <div className="inventory">
          <div className="grid">{cells}</div>
          <div className="detail">
            {def && focused ? (
              <>
                <div className="icon">{def.icon}</div>
                <div className="name">{def.name}{focused.count > 1 ? ` ×${focused.count}` : ''}</div>
                <div className="desc">{def.description}</div>
                <button className="btn primary small" onClick={() => api.useItem(focus)}>使用</button>
              </>
            ) : (
              <div className="desc">空格子。點擊物品拿起，再點擊另一格放下或交換。</div>
            )}
          </div>
        </div>
        <p className="footer"><kbd>Tab</kbd> 或 <kbd>Esc</kbd> 關閉 · 點擊拿起 / 放下物品</p>
      </div>
    </div>
  );
}
