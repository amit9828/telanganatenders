'use client';

import { createContext, useContext } from 'react';

const DeskAuthContext = createContext('');

export function DeskAuthProvider({ role, children }) {
  return <DeskAuthContext.Provider value={role || ''}>{children}</DeskAuthContext.Provider>;
}

export function useServerDeskRole() {
  return useContext(DeskAuthContext);
}
