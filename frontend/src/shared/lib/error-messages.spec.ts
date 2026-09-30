import { API_ERROR_CODES, DOCUMENT_ERROR_CODES } from '@kata/shared';
import { ApiError } from '../api/client';
import { describeApiError, describeDocumentError } from './error-messages';

describe('mensajes de error', () => {
  it.each([...API_ERROR_CODES, 'NETWORK_ERROR', 'INVALID_RESPONSE'])(
    'traduce el codigo de API %s a un mensaje propio',
    (code) => {
      const message = describeApiError(new ApiError(400, code, 'detalle tecnico'));
      expect(message).not.toBe('');
      expect(message).not.toBe(describeApiError(new Error('x')));
    },
  );

  it.each(DOCUMENT_ERROR_CODES)('traduce la causa de documento %s', (code) => {
    expect(describeDocumentError(code)).not.toBe(describeDocumentError(null));
  });

  it('usa un mensaje generico para errores desconocidos', () => {
    expect(describeApiError(new Error('boom'))).toBe('Ocurrió un error inesperado.');
    expect(describeApiError(new ApiError(500, 'CODIGO_NUEVO', 'x'))).toBe('Ocurrió un error inesperado.');
    expect(describeDocumentError('CODIGO_NUEVO')).toBe('El documento no se pudo procesar.');
  });
});
