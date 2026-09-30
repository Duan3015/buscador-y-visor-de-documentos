import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentContent } from './document-content';

describe('DocumentContent', () => {
  it('muestra un TXT respetando los saltos de linea como texto', () => {
    const { container } = render(<DocumentContent format="TXT" content={'Primera linea\n<b>no es negrita</b>'} />);

    const pre = container.querySelector('pre');
    expect(pre).toHaveTextContent('Primera linea');
    expect(container.querySelector('b')).toBeNull();
    expect(pre).toHaveTextContent('<b>no es negrita</b>');
  });

  it('renderiza Markdown como elementos de React', () => {
    const { container } = render(
      <DocumentContent format="MARKDOWN" content={'# Titulo\n\nTexto con **negrita** y `codigo`.\n\n- uno\n- dos'} />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Titulo' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('negrita');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('descarta el HTML incrustado y no crea elementos ejecutables (E-24, E-42)', () => {
    const hostile = [
      '# Seguro',
      '<script>window.__hacked = true</script>',
      '<img src="x" onerror="window.__hacked = true">',
      '<iframe src="https://example.com"></iframe>',
      '[clic](javascript:alert(1))',
      '![logo](https://example.com/track.png)',
    ].join('\n\n');

    const { container } = render(<DocumentContent format="MARKDOWN" content={hostile} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect((window as unknown as { __hacked?: boolean }).__hacked).toBeUndefined();
    const link = screen.getByText('clic').closest('a');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect(screen.getByText('[imagen: logo]')).toBeInTheDocument();
  });

  it('abre los enlaces aparte sin acceso a la ventana de origen', () => {
    render(<DocumentContent format="MARKDOWN" content="[docs](https://example.com/docs)" />);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('carga el contenido extenso por secciones a demanda (E-24)', async () => {
    const section = `${'palabra '.repeat(2400)}\n\n`;
    const content = Array.from({ length: 5 }, (_, n) => `Seccion ${n + 1}\n${section}`).join('');

    render(<DocumentContent format="TXT" content={content} />);

    expect(screen.getByText(/Mostrando 1 de/)).toBeInTheDocument();
    expect(screen.queryByText(/Seccion 5/)).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Mostrar más' });
    await userEvent.click(button);
    expect(screen.getByText(/Mostrando 2 de/)).toBeInTheDocument();

    for (let i = 0; i < 10 && screen.queryByRole('button', { name: 'Mostrar más' }); i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));
    }
    expect(screen.queryByRole('button', { name: 'Mostrar más' })).not.toBeInTheDocument();
    expect(screen.getByText(/Seccion 5/)).toBeInTheDocument();
  });

  it('avisa cuando no hay contenido para mostrar', () => {
    render(<DocumentContent format="TXT" content="" />);

    expect(screen.getByText('El documento no tiene contenido para mostrar.')).toBeInTheDocument();
  });
});
