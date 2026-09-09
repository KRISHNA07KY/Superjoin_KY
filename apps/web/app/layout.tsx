import type { Metadata } from 'next';
import '../styles/globals.css';
import { DocumentsProvider } from '../lib/documents-store';
import { ContextPanelProvider } from '../lib/context-panel';

export const metadata: Metadata = {
  title: 'TrustLayer — Fact Knowledge Layer',
  description: 'An evidence-backed knowledge workspace built from your documents.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <DocumentsProvider>
          <ContextPanelProvider>
            {children}
          </ContextPanelProvider>
        </DocumentsProvider>
      </body>
    </html>
  );
}
