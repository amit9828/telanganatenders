'use client';

import { createContext, useContext } from 'react';

const DeskAuthContext = createContext(false);

export function DeskAuthProvider({ children }) {
  return <DeskAuthContext.Provider value={true}>{children}</DeskAuthContext.Provider>;
}

export function useServerDeskAllowed() {
  return useContext(DeskAuthContext);
}
