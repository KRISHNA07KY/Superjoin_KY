'use client';

/**
 * Shared document list, polled while any document is still processing.
 * Used by the left sidebar on every route so upload + status stay in sync
 * across the chat, fact explorer, and conflict explorer pages.
 */

import React from 'react';
import { ApiError, listDocuments, uploadDocument, type Document } from './api';

const TERMINAL_STATUSES = new Set(['ready', 'failed']);
const POLL_MS = 3000;

interface DocumentsState {
  documents: Document[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upload: (file: File) => Promise<Document>;
}

const DocumentsCtx = React.createContext<DocumentsState | null>(null);

export function DocumentsProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = React.useState<Document[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    const hasPending = documents.some((d) => !TERMINAL_STATUSES.has(d.status));
    if (!hasPending) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [documents, refresh]);

  const upload = React.useCallback(async (file: File) => {
    const res = await uploadDocument(file);
    setDocuments((prev) => {
      const withoutExisting = prev.filter((d) => d.id !== res.document.id);
      return [res.document, ...withoutExisting];
    });
    return res.document;
  }, []);

  const value = React.useMemo(
    () => ({ documents, loading, error, refresh, upload }),
    [documents, loading, error, refresh, upload],
  );

  return <DocumentsCtx.Provider value={value}>{children}</DocumentsCtx.Provider>;
}

export function useDocuments(): DocumentsState {
  const ctx = React.useContext(DocumentsCtx);
  if (!ctx) throw new Error('useDocuments must be used within DocumentsProvider');
  return ctx;
}
