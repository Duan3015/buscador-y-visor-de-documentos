'use client';

import type { DocumentFormat } from '@kata/shared';
import { useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Button } from '../../shared/ui/button';
import { splitIntoBlocks } from './split-blocks';

/**
 * Markdown seguro por construccion: react-markdown genera elementos de React (no inserta HTML) y
 * skipHtml descarta el HTML incrustado. Las imagenes no se cargan (evita solicitudes externas) y
 * los enlaces se abren aparte sin dar acceso a la ventana de origen.
 */
const MARKDOWN_COMPONENTS: Components = {
  img: ({ alt }) => <span className="italic text-slate-500">{alt ? `[imagen: ${alt}]` : '[imagen]'}</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-700 underline">
      {children}
    </a>
  ),
};

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="prose-content flex flex-col gap-3 text-slate-900 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 [&_table]:border [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown skipHtml components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export interface DocumentContentProps {
  content: string;
  format: DocumentFormat;
}

/** Contenido por bloques: se muestra el primero y el resto se carga a demanda (E-24). */
export function DocumentContent({ content, format }: DocumentContentProps) {
  const markdown = format === 'MARKDOWN';
  const blocks = useMemo(() => splitIntoBlocks(content, { markdown }), [content, markdown]);
  const [visible, setVisible] = useState(1);

  if (blocks.length === 0) {
    return <p className="text-slate-600">El documento no tiene contenido para mostrar.</p>;
  }

  const shown = blocks.slice(0, visible);
  const remaining = blocks.length - shown.length;

  return (
    <article aria-label="Contenido del documento" className="rounded-lg border border-slate-200 bg-white p-6">
      {shown.map((block, index) =>
        markdown ? (
          <MarkdownBlock key={index} text={block} />
        ) : (
          <pre key={index} className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-900">
            {block}
          </pre>
        ),
      )}
      {remaining > 0 ? (
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="text-sm text-slate-600">
            Mostrando {shown.length} de {blocks.length} secciones
          </span>
          <Button variant="secondary" onClick={() => setVisible((count) => count + 1)}>
            Mostrar más
          </Button>
        </div>
      ) : null}
    </article>
  );
}
