import { createContext, useContext } from 'react';
import type { GameApi } from '../game/session';

export const ApiContext = createContext<GameApi | null>(null);

export function useApi(): GameApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi outside <ApiContext.Provider>');
  return api;
}
