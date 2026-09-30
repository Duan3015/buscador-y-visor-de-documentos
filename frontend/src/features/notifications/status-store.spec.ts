import { EARLY_EVENTS_LIMIT, StatusStore } from './status-store';

describe('StatusStore', () => {
  it('sigue un documento en PROCESANDO y lo lista como pendiente', () => {
    const store = new StatusStore();

    store.track('a');

    expect(store.get('a')).toEqual({ status: 'PROCESANDO', errorCode: null });
    expect(store.pendingIds()).toEqual(['a']);
  });

  it('aplica el estado final y lo quita de los pendientes', () => {
    const store = new StatusStore();
    store.track('a');

    store.apply('a', 'ERROR', 'PDF_CORRUPT');

    expect(store.get('a')).toEqual({ status: 'ERROR', errorCode: 'PDF_CORRUPT' });
    expect(store.pendingIds()).toEqual([]);
  });

  it('no permite que un estado final retroceda ni cambie (evento duplicado o tardio)', () => {
    const store = new StatusStore();
    store.track('a');
    store.apply('a', 'INDEXADO');

    store.apply('a', 'ERROR', 'WORKER_LOST');
    store.apply('a', 'PROCESANDO');

    expect(store.get('a')).toEqual({ status: 'INDEXADO', errorCode: null });
  });

  it('no sigue por su cuenta los documentos ajenos', () => {
    const store = new StatusStore();

    store.apply('ajeno', 'INDEXADO');

    expect(store.get('ajeno')).toBeUndefined();
    expect(store.pendingIds()).toEqual([]);
  });

  it('aplica un evento que llego antes de empezar el seguimiento (indexado antes del 202)', () => {
    const store = new StatusStore();
    store.apply('rapido', 'INDEXADO');

    store.track('rapido');

    expect(store.get('rapido')).toEqual({ status: 'INDEXADO', errorCode: null });
    expect(store.pendingIds()).toEqual([]);
  });

  it('conserva la causa de un ERROR que llego antes del seguimiento', () => {
    const store = new StatusStore();
    store.apply('roto', 'ERROR', 'PDF_CORRUPT');

    store.track('roto');

    expect(store.get('roto')).toEqual({ status: 'ERROR', errorCode: 'PDF_CORRUPT' });
  });

  it('acota el buffer de eventos adelantados descartando los mas antiguos', () => {
    const store = new StatusStore();
    for (let n = 0; n <= EARLY_EVENTS_LIMIT; n++) store.apply(`doc-${n}`, 'INDEXADO');

    store.track('doc-0');
    store.track(`doc-${EARLY_EVENTS_LIMIT}`);

    expect(store.get('doc-0')?.status).toBe('PROCESANDO');
    expect(store.get(`doc-${EARLY_EVENTS_LIMIT}`)?.status).toBe('INDEXADO');
  });

  it('track no pisa un estado ya recibido', () => {
    const store = new StatusStore();
    store.track('a');
    store.apply('a', 'INDEXADO');

    store.track('a');

    expect(store.get('a')?.status).toBe('INDEXADO');
  });

  it('notifica a los suscriptores solo cuando hay cambios y permite darse de baja', () => {
    const store = new StatusStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.track('a');
    store.track('a');
    store.apply('a', 'INDEXADO');
    store.apply('a', 'INDEXADO');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.track('b');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
