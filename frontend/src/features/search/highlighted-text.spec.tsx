import { HIGHLIGHT_END, HIGHLIGHT_START } from '@kata/shared';
import { render } from '@testing-library/react';
import { HighlightedText } from './highlighted-text';

describe('HighlightedText', () => {
  it('resalta las coincidencias con mark y deja el resto como texto', () => {
    const { container } = render(
      <p>
        <HighlightedText fragment={`la ${HIGHLIGHT_START}instalación${HIGHLIGHT_END} del servidor`} />
      </p>,
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('instalación');
    expect(container).toHaveTextContent('la instalación del servidor');
  });

  it('muestra el HTML del documento como texto y no crea elementos ejecutables', () => {
    const hostile = `<script>alert(1)</script> ${HIGHLIGHT_START}<img src=x onerror=alert(1)>${HIGHLIGHT_END}`;

    const { container } = render(
      <p>
        <HighlightedText fragment={hostile} />
      </p>,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
    expect(container.querySelector('mark')).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('tolera un resaltado sin cerrar', () => {
    const { container } = render(
      <p>
        <HighlightedText fragment={`inicio ${HIGHLIGHT_START}sin cierre`} />
      </p>,
    );

    expect(container.querySelector('mark')).toHaveTextContent('sin cierre');
  });
});
