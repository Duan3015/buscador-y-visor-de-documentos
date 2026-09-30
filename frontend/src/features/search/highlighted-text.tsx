import { parseHighlight } from '@kata/shared';

/**
 * Pinta un fragmento con delimitadores de resaltado. Cada segmento es un nodo de texto de React:
 * nunca se usa innerHTML, de modo que un `<script>` dentro del documento se muestra como texto.
 */
export function HighlightedText({ fragment }: { fragment: string }) {
  const segments = parseHighlight(fragment);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}
