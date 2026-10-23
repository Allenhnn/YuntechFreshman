import { HOTBAR_SIZE } from '../state/items';
import { gameStore } from '../state/store';
import type { GameApi } from './session';
import type { PointerLock } from '../input/pointerLock';

/**
 * UI hotkeys (not gameplay actions, which go through input.ts at the fixed step):
 *   Tab  背包     P  手機     M  小地圖 ⇄ 全螢幕     1–5  快捷欄     E  互動（電梯）
 *   Esc  關閉視窗；未鎖定滑鼠時暫停（鎖定時由 pointerlockchange 處理）
 */
export function installHotkeys(api: GameApi, lock: PointerLock): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    const s = gameStore.getState();
    if (s.phase !== 'playing' || e.repeat) return;
    switch (e.code) {
      case 'Tab':
        e.preventDefault();
        api.toggleModal('inventory');
        return;
      case 'KeyP':
        api.toggleModal('phone');
        return;
      case 'KeyM':
        api.toggleMap();
        return;
      case 'KeyE':
        api.interact();
        return;
      case 'Escape':
        if (s.modal !== 'none') api.closeModal();
        else if (s.mapMode === 'full') api.toggleMap();
        else if (!lock.isLocked()) api.pause();
        return;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= HOTBAR_SIZE) api.selectHotbar(n - 1);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
