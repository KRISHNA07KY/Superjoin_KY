'use client';

/**
 * Main chat workspace — the primary entry point.
 *
 * Left: AppShell sidebar (documents + upload).
 * Center: Chat thread — question input at the bottom, answer cards above.
 * Right: Context panel (PDF viewer / fact detail) — opens on citation click.
 *
 * Each "message" in the thread is a structured answer plan rendered via the
 * generative UI component registry, not raw model output.
 */

import React from 'react';
import AppShell from '../components/shell/AppShell';
import { AnswerRenderer } from '../components/answer/AnswerRenderer';
import { query, type ApiError, type LLMProvider } from '../lib/api';

interface Message {
  id: string;
  kind: 'user' | 'answer' | 'error';
  text?: string;
  plan?: unknown;
  error?: string;
}

function UserBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginBottom: 18,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: 'var(--surface-raised)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          padding: '10px 16px',
          fontSize: 14.5,
          color: 'var(--ink)',
          lineHeight: 1.55,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function AnswerBubble({ plan }: { plan: unknown }) {
  return (
    <div style={{ marginBottom: 24, maxWidth: 680 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 10,
        }}
      >
        TrustLayer
      </div>
      <AnswerRenderer raw={plan} />
    </div>
  );
}

function ErrorBubble({ error }: { error: string }) {
  return (
    <div
      style={{
        marginBottom: 18,
        padding: '10px 14px',
        background: 'var(--contradict-soft)',
        border: '1px solid var(--contradict-border)',
        borderRadius: 'var(--r-md)',
        fontSize: 13,
        color: 'var(--contradict)',
        fontFamily: 'var(--font-mono)',
        maxWidth: 540,
      }}
    >
      {error}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div
      style={{
        marginBottom: 18,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--muted)',
            display: 'inline-block',
            animation: `gw-thinking 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  const examples = [
    'What was Delhivery\'s revenue in FY24?',
    'Compare GDP growth estimates across documents.',
    'Are there any conflicting inflation forecasts?',
    'What is the workforce breakdown for Delhivery?',
  ];
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 'clamp(26px, 3vw, 40px)',
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          marginBottom: 8,
          marginTop: 0,
        }}
      >
        TrustLayer
      </h1>
      <p style={{ color: 'var(--ink-2)', maxWidth: 400, fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
        Ask any question about your documents. Every answer is grounded in evidence
        — every number links back to the exact page it came from.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          maxWidth: 520,
          width: '100%',
        }}
      >
        {examples.map((ex, i) => (
          <button
            key={i}
            id={`example-q-${i}`}
            onClick={() => {
              // Dispatch a custom event to pre-fill the input
              window.dispatchEvent(new CustomEvent('gw-example', { detail: ex }));
            }}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              textAlign: 'left',
              fontSize: 13,
              color: 'var(--ink-2)',
              cursor: 'pointer',
              lineHeight: 1.4,
              transition: 'border-color 0.12s, background 0.12s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-2)';
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [provider, setProvider] = React.useState<LLMProvider>('groq');
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Remember the model choice per-browser (not per-account — there's no
  // server-side user concept here) so it survives a reload.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem('gw-provider');
      if (saved === 'groq' || saved === 'gemini') setProvider(saved);
    } catch {
      // localStorage unavailable (private mode, etc.) — just use the default.
    }
  }, []);
  React.useEffect(() => {
    try {
      window.localStorage.setItem('gw-provider', provider);
    } catch {
      // ignore
    }
  }, [provider]);

  // Listen for example question clicks from EmptyState
  React.useEffect(() => {
    const handler = (e: Event) => {
      setInput((e as CustomEvent).detail as string);
      textareaRef.current?.focus();
    };
    window.addEventListener('gw-example', handler);
    return () => window.removeEventListener('gw-example', handler);
  }, []);

  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function submit() {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: Message = { id: crypto.randomUUID(), kind: 'user', text: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const plan = await query(question, provider);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), kind: 'answer', plan }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), kind: 'error', error: msg }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <AppShell>
      <style>{`
        @keyframes gw-thinking {
          0%, 80%, 100% { transform: scale(1); opacity: 0.4; }
          40% { transform: scale(1.4); opacity: 1; }
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          maxWidth: 780,
          margin: '0 auto',
          width: '100%',
          padding: '0 24px',
        }}
      >
        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 32, paddingBottom: 16 }}>
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((msg) => {
              if (msg.kind === 'user') return <UserBubble key={msg.id} text={msg.text!} />;
              if (msg.kind === 'answer') return <AnswerBubble key={msg.id} plan={msg.plan} />;
              if (msg.kind === 'error') return <ErrorBubble key={msg.id} error={msg.error!} />;
              return null;
            })
          )}
          {loading && <ThinkingDots />}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div
          style={{
            padding: '12px 0 20px',
            borderTop: '1px solid var(--line)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 10,
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--r-lg)',
              padding: '10px 14px',
              transition: 'border-color 0.12s',
            }}
            onFocusCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
            }}
            onBlurCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line-strong)';
            }}
          >
            <select
              id="model-provider-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as LLMProvider)}
              disabled={loading}
              title="Model provider"
              style={{
                alignSelf: 'flex-end',
                background: 'var(--surface-raised)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-pill)',
                color: 'var(--ink-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                padding: '7px 10px',
                cursor: loading ? 'default' : 'pointer',
                outline: 'none',
                flexShrink: 0,
              }}
            >
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
            </select>
            <textarea
              ref={textareaRef}
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your documents…"
              rows={1}
              disabled={loading}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'var(--font-body)',
                fontSize: 14.5,
                color: 'var(--ink)',
                lineHeight: 1.55,
                minHeight: 24,
                maxHeight: 140,
              }}
            />
            <button
              id="chat-submit"
              onClick={submit}
              disabled={!input.trim() || loading}
              style={{
                alignSelf: 'flex-end',
                background: input.trim() && !loading ? 'var(--accent)' : 'var(--surface-overlay)',
                border: 'none',
                borderRadius: 'var(--r-md)',
                color: input.trim() && !loading ? '#fff' : 'var(--muted)',
                cursor: input.trim() && !loading ? 'pointer' : 'default',
                fontSize: 18,
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.12s',
              }}
              title="Send (Enter)"
            >
              ↑
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            Enter to send · Shift+Enter for newline
          </div>
        </div>
      </div>
    </AppShell>
  );
}
