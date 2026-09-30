import { ConfigError, loadConfig, maskDatabaseUrl } from './env';

const base = { DATABASE_URL: 'postgres://docs:secreto@localhost:5433/docs' };

describe('loadConfig', () => {
  it('aplica los valores por defecto documentados en ADR-14', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      appRole: 'all',
      port: 3001,
      storageDir: './storage',
      corsOrigin: 'http://localhost:3000',
      maxUploadBytesText: 3_145_728,
      maxUploadBytesPdf: 20_971_520,
      maxPdfPages: 1000,
      maxExtractedChars: 3_000_000,
      maxIndexableChars: 300_000,
      maxHighlightChars: 100_000,
      extractionTimeoutMs: 60_000,
      workerConcurrency: 2,
      jobRetryLimit: 3,
      jobRetryDelaySeconds: 10,
      maxSseClients: 500,
    });
  });

  it('convierte numeros y roles desde texto', () => {
    const config = loadConfig({ ...base, PORT: '4000', APP_ROLE: 'worker', WORKER_CONCURRENCY: '4' });
    expect(config.port).toBe(4000);
    expect(config.appRole).toBe('worker');
    expect(config.workerConcurrency).toBe(4);
  });

  it('trata una variable vacia como ausente', () => {
    expect(loadConfig({ ...base, PORT: '' }).port).toBe(3001);
  });

  it('falla si falta DATABASE_URL y nombra la variable (E-29)', () => {
    expect.assertions(2);
    try {
      loadConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).invalidVariables).toContain('DATABASE_URL');
    }
  });

  it('lista todas las variables incorrectas a la vez (E-29)', () => {
    expect.assertions(1);
    try {
      loadConfig({ ...base, PORT: 'abc', APP_ROLE: 'otro', MAX_PDF_PAGES: '-1' });
    } catch (error) {
      expect((error as ConfigError).invalidVariables.sort()).toEqual(['APP_ROLE', 'MAX_PDF_PAGES', 'PORT']);
    }
  });

  it('no incluye valores en el mensaje de error (E-29)', () => {
    expect.assertions(2);
    try {
      loadConfig({ DATABASE_URL: 'mysql://usuario:clave-secreta@host/db' });
    } catch (error) {
      expect((error as Error).message).not.toContain('clave-secreta');
      expect((error as ConfigError).messages.join(' ')).not.toContain('clave-secreta');
    }
  });

  it('rechaza un MAX_INDEXABLE_CHARS que rompe el invariante de resaltado', () => {
    expect(() => loadConfig({ ...base, MAX_INDEXABLE_CHARS: '500000', MAX_EXTRACTED_CHARS: '3000000' })).toThrow(
      ConfigError,
    );
  });

  it('rechaza MAX_INDEXABLE_CHARS mayor que MAX_EXTRACTED_CHARS', () => {
    expect(() => loadConfig({ ...base, MAX_INDEXABLE_CHARS: '200000', MAX_EXTRACTED_CHARS: '100000' })).toThrow(
      ConfigError,
    );
  });

  it('rechaza MAX_HIGHLIGHT_CHARS mayor que MAX_INDEXABLE_CHARS', () => {
    expect.assertions(2);
    try {
      loadConfig({ ...base, MAX_INDEXABLE_CHARS: '50000', MAX_HIGHLIGHT_CHARS: '60000' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).invalidVariables).toEqual(['MAX_HIGHLIGHT_CHARS']);
    }
  });

  it('rechaza un MAX_HIGHLIGHT_CHARS invalido y nombra la variable', () => {
    expect.assertions(1);
    try {
      loadConfig({ ...base, MAX_HIGHLIGHT_CHARS: '0' });
    } catch (error) {
      expect((error as ConfigError).invalidVariables).toEqual(['MAX_HIGHLIGHT_CHARS']);
    }
  });

  it('acepta una ventana de resaltado personalizada dentro del tope indexable', () => {
    expect(loadConfig({ ...base, MAX_HIGHLIGHT_CHARS: '50000' }).maxHighlightChars).toBe(50_000);
  });

  it('acepta cero reintentos', () => {
    expect(loadConfig({ ...base, JOB_RETRY_LIMIT: '0' }).jobRetryLimit).toBe(0);
  });
});

describe('maskDatabaseUrl', () => {
  it('oculta la contrasenia', () => {
    expect(maskDatabaseUrl(base.DATABASE_URL)).not.toContain('secreto');
  });

  it('no falla con una URL invalida', () => {
    expect(maskDatabaseUrl('no es url')).toBe('[URL invalida]');
  });
});
