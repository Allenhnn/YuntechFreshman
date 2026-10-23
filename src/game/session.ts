import type { AudioBus } from '../audio/audio';
import type { PointerLock } from '../input/pointerLock';
import { dispatch } from '../state/commands';
import { actions, gameStore, type Modal } from '../state/store';
import type { Settings } from '../state/settings';

/**
 * Everything the React UI is allowed to do. Methods that need a user gesture (pointer lock,
 * audio unlock) run synchronously inside the click / keydown handler that calls them.
 */
export interface GameApi {
  startGame(): void;
  resume(): void;
  pause(): void;
  quitToMenu(): void;
  toggleModal(modal: Exclude<Modal, 'none'>): void;
  /** E key: use the nearest interactable, if any. */
  interact(): void;
  /** Opens a modal from game code (e.g. the elevator menu after an interaction). */
  openModal(modal: Exclude<Modal, 'none'>): void;
  elevatorTo(level: string): void;
  closeModal(): void;
  toggleMap(): void;
  selectHotbar(index: number): void;
  clickSlot(index: number): void;
  useItem(slot: number): void;
  respawn(): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Canvas click while playing without pointer lock. */
  relock(): void;
  click(): void;
}

export function createSession(lock: PointerLock, audio: AudioBus): GameApi {
  const get = gameStore.getState;
  /** Set while we release the lock on purpose (opening a modal) so the unlock doesn't pause. */
  let expectUnlock = false;

  const acquire = async (): Promise<void> => {
    if (get().lookMode === 'drag') return;
    const result = await lock.request();
    if (result === 'unsupported') {
      actions.setLookMode('drag');
      actions.setNeedsRelock(false);
      actions.toast('此環境無法鎖定滑鼠：按住左鍵拖曳旋轉視角，Esc 暫停');
    } else if (result === 'cooldown') {
      if (get().phase === 'playing' && get().modal === 'none') actions.setNeedsRelock(true);
      else actions.setMenuHint('瀏覽器需要約 1 秒冷卻，請稍候再點一次');
    }
  };

  lock.onChange((locked) => {
    if (locked) {
      actions.setNeedsRelock(false);
      if (get().phase !== 'playing') actions.setPhase('playing');
      return;
    }
    if (expectUnlock) {
      expectUnlock = false;
      return;
    }
    // Esc while locked: the browser releases the lock and swallows the key, so pause here.
    if (get().phase === 'playing') {
      actions.setPhase('paused');
      audio.play('close');
    }
  });

  const enterPlaying = (): void => {
    audio.unlock();
    audio.play('click');
    actions.setMenuHint('');
    actions.setPhase('playing');
    void acquire();
  };

  const closeModal = (): void => {
    if (get().modal === 'none') return;
    actions.setModal('none');
    audio.play('close');
    void acquire(); // succeeds from Tab / P / clicks; Esc is not a lock-granting gesture
  };

  return {
    startGame: enterPlaying,
    resume: enterPlaying,
    pause() {
      if (get().phase !== 'playing') return;
      lock.release();
      actions.setPhase('paused');
      audio.play('close');
    },
    quitToMenu() {
      audio.play('click');
      lock.release();
      actions.setPhase('menu');
      dispatch({ type: 'respawn' });
    },
    toggleModal(modal) {
      if (get().phase !== 'playing') return;
      if (get().modal === modal) {
        closeModal();
        return;
      }
      actions.setModal(modal);
      audio.play('open');
      if (lock.isLocked()) {
        expectUnlock = true;
        lock.release();
      }
    },
    closeModal,
    interact() {
      if (get().phase === 'playing' && get().modal === 'none' && get().interactPrompt) dispatch({ type: 'interact' });
    },
    openModal(modal) {
      if (get().phase !== 'playing' || get().modal === modal) return;
      actions.setModal(modal);
      audio.play('open');
      if (lock.isLocked()) {
        expectUnlock = true;
        lock.release();
      }
    },
    elevatorTo(level) {
      const menu = get().elevator;
      if (!menu) return;
      audio.play('click');
      dispatch({ type: 'elevatorTo', building: menu.building, level });
      closeModal();
    },
    toggleMap() {
      if (get().phase !== 'playing' || get().modal !== 'none') return;
      actions.toggleMap();
      audio.play(get().mapMode === 'full' ? 'open' : 'close');
    },
    selectHotbar(index) {
      actions.selectHotbar(index);
      audio.play('click', 0.6);
    },
    clickSlot(index) {
      actions.clickSlot(index);
      audio.play('click', 0.6);
    },
    useItem(slot) {
      dispatch({ type: 'useItem', slot });
    },
    respawn() {
      dispatch({ type: 'respawn' });
      closeModal();
    },
    updateSettings(patch) {
      actions.updateSettings(patch);
    },
    relock() {
      const s = get();
      if (s.phase === 'playing' && s.modal === 'none' && !lock.isLocked()) void acquire();
    },
    click() {
      audio.unlock();
      audio.play('click');
    },
  };
}
