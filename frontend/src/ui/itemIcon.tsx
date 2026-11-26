import type { ReactNode } from 'react';
import { ITEMS, type ItemId } from '../state/items';
import { itemIcon } from '../items/itemIcons';
import { Rich } from './icons';

/** An item's picture (its 3D model, photographed once), or its emoji when there is none. */
export function ItemIcon({ id }: { id: ItemId }): ReactNode {
  const src = itemIcon(id);
  return src ? <img className="item-pic" src={src} alt={ITEMS[id].name} draggable={false} /> : <Rich t={ITEMS[id].icon} />;
}
