import { dispatch } from '../state/commands';
import { HOTBAR_SIZE } from '../state/items';
import { TESTER_AVAILABLE, TESTER_SPEEDS, actions, gameStore } from '../state/store';
import type { GameApi } from './session';
import type { PointerLock } from '../input/pointerLock';
import { runEscape } from '../ui/escape';

/**
 * UI hotkeys (not gameplay actions, which go through input.ts at the fixed step):
 *   Tab  背包     P  手機     M  小地圖 ⇄ 全螢幕     1–5  快捷欄     E  互動（電梯）     Q  離開計時賽     X  結束導航
 *   Esc  關閉視窗；未鎖定滑鼠時暫停（鎖定時由 pointerlockchange 處理）
 *   Enter  對話框（可輸入 /指令，/help 列出）
 * 測試員模式（開發版 ` 開關，或在對話框輸入 /tester）：`  開關     F  飛行     N  穿牆     + / -  速度倍率
 */
function testerKey(code: string): boolean {
  const t = gameStore.getState().tester;
  if (code === 'Backquote') {
    if (!TESTER_AVAILABLE) return false; // production: switch it on with /tester in the chat box
    actions.setTester({ enabled: !t.enabled });
    actions.toast(t.enabled ? '測試員模式：關閉' : '測試員模式：開啟（F 飛行、N 穿牆、+/- 速度）');
    return true;
  }
  if (!t.enabled) return false;
  switch (code) {
    case 'KeyF':
      actions.setTester({ fly: !t.fly, noclip: t.fly ? false : t.noclip });
      actions.toast(t.fly ? '飛行：關閉' : '飛行：開啟（Space 上升、C 下降）');
      return true;
    case 'KeyN':
      actions.setTester({ noclip: !t.noclip });
      actions.toast(t.noclip ? '穿牆：關閉（仍在飛行，按 F 落地）' : '穿牆：開啟（同時開啟飛行）');
      return true;
    case 'Equal':
    case 'NumpadAdd':
    case 'Minus':
    case 'NumpadSubtract': {
      const i = TESTER_SPEEDS.indexOf(t.speed as (typeof TESTER_SPEEDS)[number]);
      const up = code === 'Equal' || code === 'NumpadAdd';
      const speed = TESTER_SPEEDS[Math.max(0, Math.min(TESTER_SPEEDS.length - 1, i + (up ? 1 : -1)))]!;
      actions.setTester({ speed });
      actions.toast(`速度 ×${speed}`);
      return true;
    }
  }
  return false;
}

export function installHotkeys(api: GameApi, lock: PointerLock): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    const s = gameStore.getState();
    if (s.phase !== 'playing' || e.repeat) return;
    // Typing in a field (map search) is not a hotkey.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (s.modal === 'none' && testerKey(e.code)) return;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && s.modal === 'none' && s.mapMode === 'mini') {
      e.preventDefault(); // the chat input mounts focused; this Enter must not reach it
      api.openModal('chat');
      return;
    }
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
      case 'KeyJ':
        if (s.sport) return; // J shoots / blocks in the 3v3 game
        api.toggleModal('quests');
        return;
      case 'KeyG':
        if (s.modal === 'none') dispatch({ type: 'storyGuide' });
        return;
      case 'KeyX':
        if (s.nav && s.modal === 'none' && s.mapMode === 'mini') api.stopNav();
        return;
      case 'KeyQ':
        if (s.race) api.leaveRace();
        else if (s.sport) api.leaveSport();
        return;
      case 'KeyE':
        api.interact();
        return;
      case 'Escape':
        // Innermost first: a story scene must be finished with its buttons; then a window's own
        // back step (chat thread → app → phone home), the window, the full map; pausing is last.
        if (s.modal === 'story') return;
        if (s.modal !== 'none' && runEscape()) return;
        if (s.modal !== 'none') api.closeModal();
        else if (s.mapMode === 'full') api.toggleMap();
        else if (!lock.isLocked()) api.pause();
        return;
    }
    if (e.code.startsWith('Digit') && s.modal !== 'story') { // story games use the number keys
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= HOTBAR_SIZE) api.selectHotbar(n - 1);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
