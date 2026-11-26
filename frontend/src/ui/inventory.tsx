import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ItemIcon } from './itemIcon';
import { HOTBAR_SIZE, ITEMS } from '../state/items';
import { useGame } from '../state/store';
import { useApi } from './api';
import { Icon } from './icons';

/** Last pointer position, so a ghost appears under the cursor on its first frame. */
const pointer = { x: 0, y: 0 };
/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_START = 6;

/** The item icon following the cursor while it is dragged or held; moved without React re-renders. */
function Ghost({ icon }: { icon: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (ref.current) ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  return <div ref={ref} className="slot-ghost" style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}>{icon}</div>;
}

export function InventoryModal(): ReactNode {
  const api = useApi();
  const slots = useGame((s) => s.inventory);
  const held = useGame((s) => s.heldSlot);
  const hotbar = useGame((s) => s.hotbarIndex);
  const [focus, setFocus] = useState<number>(hotbar);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const press = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  const focused = slots[focus] ?? null;
  const def = focused ? ITEMS[focused.id] : null;

  // Press → drag → release over a slot; a press that never moves is a click (pick up / put down).
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const p = press.current;
      if (!p || p.moved || Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
      p.moved = true;
      setDragFrom(p.from);
    };
    const up = (e: PointerEvent): void => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      if (!p.moved) {
        setFocus(p.from);
        api.clickSlot(p.from);
        return;
      }
      setDragFrom(null);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]');
      const to = target ? Number(target.dataset.slot) : NaN;
      if (Number.isInteger(to) && to !== p.from) {
        api.moveSlot(p.from, to);
        setFocus(to);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [api]);

  const onPointerDown = (i: number, e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / native drag
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    // Only a full slot can be dragged; an empty one still takes clicks (to put a held item down).
    press.current = { from: i, x: slots[i] ? e.clientX : Infinity, y: e.clientY, moved: false };
  };

  const cells: ReactNode[] = [];
  slots.forEach((stack, i) => {
    if (i === 0) cells.push(<div key="l0" className="row-label">快捷欄（1–5）</div>);
    if (i === HOTBAR_SIZE) cells.push(<div key="l1" className="row-label">背包</div>);
    const cls = ['slot', i === focus ? 'selected' : '', i === held ? 'held' : '', i === dragFrom ? 'dragging' : ''].filter(Boolean).join(' ');
    cells.push(
      <button
        key={i}
        data-slot={i}
        className={cls}
        onMouseEnter={() => setFocus(i)}
        onPointerDown={(e) => onPointerDown(i, e)}
        onClick={(e) => {
          if (e.detail !== 0) return; // mouse clicks are handled on pointer up; this is Enter / Space
          setFocus(i);
          api.clickSlot(i);
        }}
        onDoubleClick={() => stack && api.inspectItem(i)}
      >
        {i < HOTBAR_SIZE && <span className="num">{i + 1}</span>}
        {stack && <ItemIcon id={stack.id} />}
        {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
      </button>,
    );
  });

  const ghostSlot = dragFrom ?? held;
  const ghostStack = ghostSlot !== null ? slots[ghostSlot] : null;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && api.closeModal()}>
      <div className="card wide" style={{ width: 'auto' }}>
        <div className="modal-head">
          <h2>背包</h2>
          <button className="close-x" aria-label="關閉" onClick={api.closeModal}><Icon name="close" /></button>
        </div>
        <div className="inventory">
          <div className="grid">{cells}</div>
          <div className="detail">
            {def && focused ? (
              <>
                <div className="icon"><ItemIcon id={focused.id} /></div>
                <div className="name">{def.name}{focused.count > 1 ? ` ×${focused.count}` : ''}</div>
                <div className="desc">{def.description}</div>
                <button className="btn primary small" onClick={() => api.inspectItem(focus)}>拿出來看 / 使用</button>
              </>
            ) : (
              <div className="desc">空格子。拖曳物品到另一格可移動或交換；也可以點一下拿起、再點一格放下。</div>
            )}
          </div>
        </div>
        <p className="footer"><kbd>Tab</kbd> 或 <kbd>Esc</kbd> 關閉 · 拖曳或點擊移動物品 · 雙擊拿出來看</p>
      </div>
      {ghostStack && <Ghost icon={<ItemIcon id={ghostStack.id} />} />}
    </div>
  );
}
