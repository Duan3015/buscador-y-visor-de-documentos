import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConnectionBanner } from '../features/notifications/connection-banner';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Buscador y Visor de Documentos Técnicos',
  description: 'Cargue, busque y lea documentos técnicos (TXT, Markdown y PDF).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <header className="border-b border-slate-200 bg-white">
            <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3" aria-label="Principal">
              <span className="font-semibold text-slate-900">Documentos técnicos</span>
              <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">
                Buscar
              </Link>
              <Link href="/upload" className="text-sm font-medium text-indigo-700 hover:underline">
                Cargar
              </Link>
            </nav>
          </header>
          <ConnectionBanner />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
