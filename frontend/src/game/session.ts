import type { AudioBus } from '../audio/audio';
import type { PointerLock } from '../input/pointerLock';
import { dispatch } from '../state/commands';
import { actions, gameStore, type Modal } from '../state/store';
import type { Settings } from '../state/settings';
import { ITEMS, type ItemId } from '../state/items';

/**
 * Everything the React UI is allowed to do. Methods that need a user gesture (pointer lock,
 * audio unlock) run synchronously inside the click / keydown handler that calls them.
 */
export interface GameApi {
  /** Starts over: wipes any saved progress. */
  startGame(): void;
  /** Resumes the progress saved in this browser. */
  continueGame(): void;
  resume(): void;
  pause(): void;
  quitToMenu(): void;
  toggleModal(modal: Exclude<Modal, 'none'>): void;
  /** E key: use the nearest interactable, if any. */
  interact(): void;
  /** Opens a modal from game code (e.g. the elevator menu after an interaction). */
  openModal(modal: Exclude<Modal, 'none'>): void;
  /** Phone camera mode (first person, phone held up). */
  openCamera(): void;
  takePhoto(): void;
  /** Quits the ball game in progress (Q). */
  leaveSport(): void;
  flipCamera(): void;
  cameraLook(dx: number, dy: number): void;
  /** Opens the phone on its album. */
  openAlbum(): void;
  elevatorTo(level: string): void;
  closeModal(): void;
  toggleMap(): void;
  /** Map teleport (campus metres); closes the full map. */
  teleportTo(x: number, z: number, label: string): void;
  selectHotbar(index: number): void;
  clickSlot(index: number): void;
  /** Drag and drop in the inventory. */
  moveSlot(from: number, to: number): void;
  useItem(slot: number): void;
  /** Starts navigation to a map place; closes the full map. */
  navigateTo(x: number, z: number, name: string): void;
  /** Ends navigation (button or X). */
  stopNav(): void;
  /** Quits the track time trial (button or Q). */
  leaveRace(): void;
  /** Cafeteria stall purchase. */
  buy(id: ItemId, price: number): void;
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

  const toggleMap = (): void => {
    if (get().phase !== 'playing' || get().modal !== 'none') return;
    actions.toggleMap();
    const full = get().mapMode === 'full';
    audio.play(full ? 'open' : 'close');
    // The full map is interactive (zoom, pan, teleport): free the mouse while it is open.
    if (full && lock.isLocked()) {
      expectUnlock = true;
      lock.release();
    } else if (!full) {
      void acquire();
    }
  };

  return {
    startGame() {
      actions.resetProgress();
      dispatch({ type: 'newGame' });
      enterPlaying();
    },
    continueGame() {
      dispatch({ type: 'loadSave' });
      enterPlaying();
    },
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
      dispatch({ type: 'toStart' });
    },
    toggleModal(modal) {
      if (get().phase !== 'playing') return;
      if (get().modal === modal) {
        closeModal();
        return;
      }
      if (modal === 'phone') actions.setPhonePage('home'); // the phone opens on its home screen
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
    openCamera() {
      if (get().phase !== 'playing') return;
      actions.setModal('camera');
      audio.play('open');
      if (lock.isLocked()) {
        expectUnlock = true;
        lock.release();
      }
    },
    leaveSport() {
      dispatch({ type: 'leaveSport' });
    },
    takePhoto() {
      if (get().modal === 'camera') dispatch({ type: 'photo' });
    },
    flipCamera() {
      actions.setCameraSelfie(!get().cameraSelfie);
      audio.play('click', 0.6);
    },
    cameraLook(dx, dy) {
      if (get().modal === 'camera') dispatch({ type: 'cameraLook', dx, dy });
    },
    openAlbum() {
      actions.setPhonePage('album');
      actions.setModal('phone');
      audio.play('open');
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
    toggleMap,
    teleportTo(x, z, label) {
      if (get().phase !== 'playing') return;
      audio.play('click');
      dispatch({ type: 'teleport', x, z, label });
      if (get().mapMode === 'full') toggleMap();
    },
    selectHotbar(index) {
      actions.selectHotbar(index);
      audio.play('click', 0.6);
    },
    clickSlot(index) {
      actions.clickSlot(index);
      audio.play('click', 0.6);
    },
    moveSlot(from, to) {
      actions.moveSlot(from, to);
      audio.play('click', 0.6);
    },
    buy(id, price) {
      const problem = actions.buy(id, price);
      if (problem) {
        actions.toast(problem);
        audio.play('close');
      } else {
        actions.toast(`買了 ${ITEMS[id].name}，放進背包了`);
        audio.play('coin');
      }
    },
    navigateTo(x, z, name) {
      if (get().phase !== 'playing') return;
      audio.play('click');
      dispatch({ type: 'navigate', x, z, name });
      if (get().mapMode === 'full') toggleMap();
    },
    stopNav() {
      if (!get().nav) return;
      audio.play('close');
      dispatch({ type: 'stopNav' });
    },
    leaveRace() {
      if (get().race) {
        audio.play('close');
        dispatch({ type: 'leaveRace' });
      }
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
      if (s.phase === 'playing' && s.modal === 'none' && s.mapMode === 'mini' && !lock.isLocked()) void acquire();
    },
    click() {
      audio.unlock();
      audio.play('click');
    },
  };
}
