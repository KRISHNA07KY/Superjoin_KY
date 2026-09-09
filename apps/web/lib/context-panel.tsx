'use client';

/**
 * Shared state for the right-hand "context panel": whatever fact / evidence /
 * document a citation chip or card was clicked from. Lives above the app
 * shell so both the chat/answer components and the fact/conflict explorer
 * routes can open it via the same hook.
 */

import React from 'react';
import type { FactView } from './api';

export type ContextTarget =
  | { kind: 'document'; documentId: string; filename: string; page: number; label?: string }
  | { kind: 'fact'; fact: FactView }
  | null;

interface ContextPanelState {
  target: ContextTarget;
  collapsed: boolean;
  openDocument: (documentId: string, filename: string, page: number, label?: string) => void;
  openFact: (fact: FactView) => void;
  close: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

const ContextPanelCtx = React.createContext<ContextPanelState | null>(null);

export function ContextPanelProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<ContextTarget>(null);
  const [collapsed, setCollapsed] = React.useState(false);

  const openDocument = React.useCallback((documentId: string, filename: string, page: number, label?: string) => {
    setTarget({ kind: 'document', documentId, filename, page, label });
    setCollapsed(false);
  }, []);

  const openFact = React.useCallback((fact: FactView) => {
    setTarget({ kind: 'fact', fact });
    setCollapsed(false);
  }, []);

  const close = React.useCallback(() => setTarget(null), []);

  const value = React.useMemo(
    () => ({ target, collapsed, openDocument, openFact, close, setCollapsed }),
    [target, collapsed, openDocument, openFact, close],
  );

  return <ContextPanelCtx.Provider value={value}>{children}</ContextPanelCtx.Provider>;
}

export function useContextPanel(): ContextPanelState {
  const ctx = React.useContext(ContextPanelCtx);
  if (!ctx) throw new Error('useContextPanel must be used within ContextPanelProvider');
  return ctx;
}
