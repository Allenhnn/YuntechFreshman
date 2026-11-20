import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GameApi } from '../game/session';
import { useGame } from '../state/store';
import { ApiContext } from './api';
import { Hud } from './hud';
import { InventoryModal } from './inventory';
import { LoadingScreen, MenuScreen } from './menus';
import { LoginScreen } from './login';
import { auth, useAuth } from '../state/auth';
import { PhoneDrawer } from './phone';
import { ElevatorModal, Fade, InteractPrompt, ShopModal } from './elevator';
import { ChatBox } from './chat';
import { CameraOverlay } from './camera';
import { AchievementPopup, BigCountdown, Celebration, QuestLog, QuestTracker, StoryModal } from './story';
import './ui.css';

function App(): ReactNode {
  const phase = useGame((s) => s.phase);
  const modal = useGame((s) => s.modal);
  const account = useAuth((s) => s.status);
  return (
    <>
      {phase === 'playing' && modal !== 'camera' && <Hud />}
      {phase === 'playing' && modal === 'camera' && <CameraOverlay />}
      {phase === 'playing' && modal === 'inventory' && <InventoryModal />}
      {phase === 'playing' && modal === 'phone' && <PhoneDrawer />}
      {phase === 'playing' && modal === 'elevator' && <ElevatorModal />}
      {phase === 'playing' && modal === 'shop' && <ShopModal />}
      {phase === 'playing' && modal === 'chat' && <ChatBox />}
      {phase === 'playing' && modal !== 'camera' && <QuestTracker />}
      {phase === 'playing' && modal === 'story' && <StoryModal />}
      {phase === 'playing' && modal === 'quests' && <QuestLog />}
      {phase === 'playing' && <AchievementPopup />}
      {phase === 'playing' && <Celebration />}
      {phase === 'playing' && <BigCountdown />}
      {phase === 'playing' && <InteractPrompt />}
      <Fade />
      {phase === 'loading' && <LoadingScreen />}
      {phase === 'menu' && account === 'checking' && <LoadingScreen />}
      {phase === 'menu' && account === 'signedOut' && <LoginScreen />}
      {phase === 'menu' && (account === 'signedIn' || account === 'offline') && <MenuScreen paused={false} />}
      {phase === 'paused' && <MenuScreen paused />}
    </>
  );
}

/** Mounts the DOM UI layer above the canvas. The UI only talks to the game through `api` and the store. */
export function mountUI(container: HTMLElement, api: GameApi): Root {
  void auth.init();
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
