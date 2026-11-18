import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GameApi } from '../game/session';
import { useGame } from '../state/store';
import { ApiContext } from './api';
import { Hud } from './hud';
import { InventoryModal } from './inventory';
import { LoadingScreen, MenuScreen } from './menus';
import { PhoneDrawer } from './phone';
import { ElevatorModal, Fade, InteractPrompt, ShopModal } from './elevator';
import { ChatBox } from './chat';
import { CameraOverlay } from './camera';
import './ui.css';

function App(): ReactNode {
  const phase = useGame((s) => s.phase);
  const modal = useGame((s) => s.modal);
  return (
    <>
      {phase === 'playing' && modal !== 'camera' && <Hud />}
      {phase === 'playing' && modal === 'camera' && <CameraOverlay />}
      {phase === 'playing' && modal === 'inventory' && <InventoryModal />}
      {phase === 'playing' && modal === 'phone' && <PhoneDrawer />}
      {phase === 'playing' && modal === 'elevator' && <ElevatorModal />}
      {phase === 'playing' && modal === 'shop' && <ShopModal />}
      {phase === 'playing' && modal === 'chat' && <ChatBox />}
      {phase === 'playing' && <InteractPrompt />}
      <Fade />
      {phase === 'loading' && <LoadingScreen />}
      {phase === 'menu' && <MenuScreen paused={false} />}
      {phase === 'paused' && <MenuScreen paused />}
    </>
  );
}

/** Mounts the DOM UI layer above the canvas. The UI only talks to the game through `api` and the store. */
export function mountUI(container: HTMLElement, api: GameApi): Root {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ApiContext.Provider value={api}>
        <App />
      </ApiContext.Provider>
    </StrictMode>,
  );
  return root;
}
