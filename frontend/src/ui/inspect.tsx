import { useEffect, type ReactNode } from 'react';
import { ITEMS, type ItemId } from '../state/items';
import { useGame } from '../state/store';
import { inspectView } from '../items/inspectView';
import { useApi } from './api';
import { Rich } from './icons';

const DRINKS = new Set<ItemId>(['waterBottle', 'bubbleTea', 'soyMilk', 'sportsDrink', 'mineralWater', 'greenTea', 'cannedCoffee']);
const FOODS = new Set<ItemId>(['bread', 'bento', 'buffet', 'beefNoodles', 'plainNoodles', 'onigiri', 'teaEgg', 'cupNoodles']);

function actionLabel(id: ItemId): string {
  if (DRINKS.has(id)) return '喝掉';
  if (FOODS.has(id)) return '吃掉';
  if (id === 'campusMap') return '打開地圖';
  if (id === 'studentCard') return '看看證件';
  if (id === 'notebook') return '翻開看';
  return '使用';
}

/**
 * The item held up in front of you (3D, drawn by the game): moving the mouse turns it, the wheel
 * brings it closer. Below: what it is, and eat / drink / use, or put it away (Esc).
 */
export function InspectView(): ReactNode {
  const api = useApi();
  const insp = useGame((s) => s.inspect);
  useEffect(() => {
    inspectView.yaw = 0.5;
    inspectView.pitch = 0.15;
    inspectView.zoom = 1;
  }, [insp?.id]);
  if (!insp) return null;
  const def = ITEMS[insp.id];
  return (
    <div
      className="inspect-layer"
      onPointerMove={(e) => {
        inspectView.yaw += e.movementX * 0.012;
        inspectView.pitch = Math.max(-1.4, Math.min(1.4, inspectView.pitch + e.movementY * 0.012));
      }}
      onWheel={(e) => { inspectView.zoom = Math.max(0.6, Math.min(1.7, inspectView.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }}
    >
      <div className="inspect-hint">移動滑鼠轉動物品・滾輪拉近拉遠</div>
      <div className="inspect-panel" onPointerMove={(e) => e.stopPropagation()}>
        <i><Rich t={def.icon} /></i>
        <div>
          <b>{def.name}</b>
          <small>{def.description}</small>
        </div>
        <button className="btn primary" onClick={() => { api.useItem(insp.slot); api.closeModal(); }}>{actionLabel(insp.id)}</button>
        <button className="btn" onClick={api.closeModal}>收起 <kbd>Esc</kbd></button>
      </div>
    </div>
  );
}
