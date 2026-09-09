'use client';

/**
 * AppShell — the persistent dark multi-panel layout.
 *
 * Left sidebar: branding, nav, document list + upload.
 * Main content: children (varies by route).
 * Right panel: context panel — PDF viewer or fact detail, slides open when
 *   a citation/card is clicked via useContextPanel().
 *
 * This component should wrap every route's content. It is NOT the root
 * layout (layout.tsx handles providers). Usage:
 *   <AppShell><YourPageContent /></AppShell>
 */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDocuments } from '../../lib/documents-store';
import { useContextPanel } from '../../lib/context-panel';
import { documentFileUrl, type FactView } from '../../lib/api';
import { ChatIcon, FlaskIcon, BoltIcon, FileIcon, CalendarIcon } from '../icons';

// ---- Status badge ----
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    uploaded: { label: 'Queued', color: 'var(--muted)' },
    processing: { label: 'Processing', color: 'var(--reconcile)' },
    ready: { label: 'Ready', color: 'var(--corroborate)' },
    failed: { label: 'Failed', color: 'var(--contradict)' },
  };
  const { label, color } = map[status] ?? { label: status, color: 'var(--muted)' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          animation: status === 'processing' ? 'gw-pulse 1.6s ease-in-out infinite' : undefined,
        }}
      />
      {label}
    </span>
  );
}

// ---- Document list item ----
function DocItem({ doc }: { doc: ReturnType<typeof useDocuments>['documents'][0] }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 'var(--r-md)',
        borderLeft: '2px solid transparent',
        marginBottom: 2,
        cursor: 'default',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontFamily: 'var(--font-body)',
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: 3,
        }}
        title={doc.filename}
      >
        {doc.filename}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusBadge status={doc.status} />
        {doc.page_count && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {doc.page_count}p
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Upload zone ----
function UploadZone() {
  const { upload } = useDocuments();
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
          setUploadError('Only PDF files are supported.');
          continue;
        }
        await upload(file);
      }
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ padding: '0 8px 12px' }}>
      <div
        id="upload-zone"
        role="button"
        tabIndex={0}
        aria-label="Upload PDF"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--line-strong)'}`,
          borderRadius: 'var(--r-md)',
          padding: '14px 12px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'var(--accent-soft)' : 'transparent',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--muted)', marginBottom: 6 }}>
          <FileIcon size={20} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-body)' }}>
          {uploading ? 'Uploading…' : 'Drop PDF or click to upload'}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {uploadError && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--contradict)', fontFamily: 'var(--font-mono)' }}>
          {uploadError}
        </div>
      )}
    </div>
  );
}

// ---- Sidebar ----
function Sidebar() {
  const { documents, loading, error } = useDocuments();
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Chat', icon: <ChatIcon size={15} /> },
    { href: '/facts', label: 'Facts', icon: <FlaskIcon size={15} /> },
    { href: '/conflicts', label: 'Conflicts', icon: <BoltIcon size={15} /> },
  ];

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        borderRight: '1px solid var(--line)',
        height: '100vh',
        position: 'sticky',
        top: 0,
        overflowY: 'auto',
      }}
    >
      {/* Branding */}
      <div
        style={{
          padding: '20px 16px 14px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 18,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            marginBottom: 2,
          }}
        >
          TrustLayer
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Fact Knowledge Layer
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '10px 8px', borderBottom: '1px solid var(--line)' }}>
        {navLinks.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '7px 10px',
                borderRadius: 'var(--r-md)',
                fontSize: 13.5,
                fontFamily: 'var(--font-body)',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--ink-2)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                textDecoration: 'none',
                marginBottom: 2,
                transition: 'all 0.12s ease',
              }}
            >
              <span style={{ display: 'flex' }}>{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Documents */}
      <div
        style={{
          padding: '10px 8px 6px',
          fontSize: 10,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Documents · {documents.length}
      </div>

      <UploadZone />

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {loading && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: 12, textAlign: 'center' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--contradict)', padding: 12, fontFamily: 'var(--font-mono)' }}>
            {error}
          </div>
        )}
        {documents.map((doc) => (
          <DocItem key={doc.id} doc={doc} />
        ))}
        {!loading && documents.length === 0 && !error && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 12px', lineHeight: 1.5 }}>
            No documents yet. Upload a PDF to get started.
          </div>
        )}
      </div>
    </aside>
  );
}

// ---- Context Panel (right side) ----
function ContextPanel() {
  const { target, collapsed, close, setCollapsed } = useContextPanel();

  if (!target) return null;

  return (
    <aside
      style={{
        width: collapsed ? 40 : 420,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        height: '100vh',
        position: 'sticky',
        top: 0,
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Collapse toggle */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {!collapsed && (
          <span style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {target.kind === 'document' ? target.filename : 'Fact Detail'}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button
            id="context-panel-toggle"
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 2,
              lineHeight: 1,
            }}
            title={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {collapsed ? '◀' : '▶'}
          </button>
          <button
            id="context-panel-close"
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 2,
              lineHeight: 1,
            }}
            title="Close panel"
          >
            ×
          </button>
        </div>
      </div>

      {!collapsed && target && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {target.kind === 'document' ? (
            <PdfViewer
              documentId={target.documentId}
              page={target.page}
              label={target.label}
            />
          ) : target.kind === 'fact' ? (
            <FactDetail fact={target.fact} />
          ) : null}
        </div>
      )}
    </aside>
  );
}

// ---- PDF Viewer ----
function PdfViewer({
  documentId,
  page,
  label,
}: {
  documentId: string;
  page: number;
  label?: string;
}) {
  const url = documentFileUrl(documentId, page);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {label && (
        <div style={{ padding: '8px 14px 6px', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line)' }}>
          {label} · p.{page}
        </div>
      )}
      <iframe
        src={url}
        title={`PDF page ${page}`}
        style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }}
      />
    </div>
  );
}

// ---- Fact Detail ----
function FactDetail({ fact }: { fact: FactView }) {
  const { openDocument } = useContextPanel();
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        Fact Detail
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
        {fact.subject ?? '—'} · {fact.predicate ?? '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--corroborate)', marginBottom: 12 }}>
        {fact.value_raw}
      </div>
      {fact.time_value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>
          <CalendarIcon size={12} style={{ color: 'var(--muted)' }} />
          {fact.time_value}{fact.scope ? ` · ${fact.scope}` : ''}
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 12 }}>
        From: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{fact.document_filename}</span>
      </div>

      {(fact.evidence ?? []).map((ev) => (
        <div
          key={ev.id}
          style={{
            background: 'var(--surface-raised)',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--line)',
            padding: 12,
            marginBottom: 8,
          }}
        >
          <blockquote
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--ink-2)',
              borderLeft: '3px solid var(--accent)',
              paddingLeft: 10,
              fontStyle: 'italic',
              lineHeight: 1.5,
            }}
          >
            "{ev.quote}"
          </blockquote>
          <button
            id={`open-pdf-${ev.id}`}
            onClick={() => openDocument(ev.document_id, fact.document_filename, ev.page_number, `p.${ev.page_number}`)}
            style={{
              marginTop: 8,
              background: 'none',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              cursor: 'pointer',
              padding: '3px 8px',
            }}
          >
            Open p.{ev.page_number} →
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- Main Export ----
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @keyframes gw-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          background: 'var(--bg)',
        }}
      >
        <Sidebar />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }}>
          {children}
        </main>
        <ContextPanel />
      </div>
    </>
  );
}
