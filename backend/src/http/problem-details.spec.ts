import { HttpException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';
import {
  DocumentNotFoundError,
  DuplicateDocumentError,
  EmptyFileError,
  FileTooLargeError,
  ServiceUnavailableError,
  UnsupportedMediaTypeError,
  ValidationFailedError,
} from '../shared-kernel/errors';
import { toProblem } from './problem-details';

const TRACE = 'trace-1234abcd';

describe('toProblem', () => {
  it.each([
    [new EmptyFileError(), 400, 'EMPTY_FILE'],
    [new DocumentNotFoundError(), 404, 'DOCUMENT_NOT_FOUND'],
    [new FileTooLargeError(10), 413, 'FILE_TOO_LARGE'],
    [new UnsupportedMediaTypeError(), 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE'],
  ])('traduce %p al estado %i y codigo %s', (error, status, code) => {
    const problem = toProblem(error, TRACE);
    expect(problem.status).toBe(status);
    expect(problem.body).toMatchObject({ status, code, traceId: TRACE });
    expect(problem.unexpected).toBe(false);
  });

  it('incluye el documento existente en el 409 (E-05)', () => {
    const existing = { id: '00000000-0000-4000-8000-000000000001', status: 'INDEXADO' as const };
    const problem = toProblem(new DuplicateDocumentError(existing), TRACE);
    expect(problem.status).toBe(409);
    expect(problem.body.existing).toEqual(existing);
  });

  it('incluye los errores por campo en las validaciones (E-03)', () => {
    const problem = toProblem(new ValidationFailedError([{ field: 'title', message: 'Obligatorio' }]), TRACE);
    expect(problem.body.errors).toEqual([{ field: 'title', message: 'Obligatorio' }]);
  });

  it('traduce un error de Zod a VALIDATION_FAILED con sus campos', () => {
    const result = z.object({ a: z.string() }).strict().safeParse({ a: 1, b: 2 });
    if (result.success) throw new Error('se esperaba un fallo');
    const problem = toProblem(result.error, TRACE);
    expect(problem.status).toBe(400);
    expect(problem.body.code).toBe('VALIDATION_FAILED');
    expect(problem.body.errors?.map((e) => e.field).sort()).toEqual(['a', 'b']);
  });

  it('traduce el limite de tamano de multer a 413 (E-02)', () => {
    const error = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
    const problem = toProblem(error, TRACE);
    expect(problem.status).toBe(413);
    expect(problem.body.code).toBe('FILE_TOO_LARGE');
  });

  it('traduce un archivo o campo inesperado de multer a 400 (E-48)', () => {
    const error = Object.assign(new Error('Unexpected field'), {
      name: 'MulterError',
      code: 'LIMIT_UNEXPECTED_FILE',
      field: 'otro',
    });
    const problem = toProblem(error, TRACE);
    expect(problem.status).toBe(400);
    expect(problem.body.errors).toEqual([{ field: 'otro', message: 'Campo o archivo no permitido' }]);
  });

  it('traduce las rutas inexistentes a NOT_FOUND', () => {
    const problem = toProblem(new NotFoundException(), TRACE);
    expect(problem.status).toBe(404);
    expect(problem.body.code).toBe('NOT_FOUND');
  });

  it('traduce un cuerpo demasiado grande del middleware a FILE_TOO_LARGE', () => {
    expect(toProblem(new PayloadTooLargeException(), TRACE).body.code).toBe('FILE_TOO_LARGE');
  });

  it('traduce un cuerpo malformado (400 del parser) a VALIDATION_FAILED (E-48)', () => {
    const problem = toProblem(Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' }), TRACE);
    expect(problem.body.code).toBe('VALIDATION_FAILED');
  });

  it('traduce un error de conexion a la base de datos a 503 (E-47)', () => {
    const problem = toProblem(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), TRACE);
    expect(problem.status).toBe(503);
    expect(problem.body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('un error no previsto responde 500 sin exponer el mensaje interno (E-47)', () => {
    const problem = toProblem(new Error('password authentication failed for user "docs" at 10.0.0.5'), TRACE);
    expect(problem.status).toBe(500);
    expect(problem.unexpected).toBe(true);
    expect(problem.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(problem.body)).not.toContain('password');
    expect(JSON.stringify(problem.body)).not.toContain('10.0.0.5');
  });

  it('un valor lanzado que no es un Error tambien responde 500', () => {
    expect(toProblem('texto', TRACE).status).toBe(500);
    expect(toProblem(undefined, TRACE).status).toBe(500);
  });

  it('un HttpException de servidor no previsto responde 500', () => {
    expect(toProblem(new HttpException('boom', 502), TRACE).status).toBe(500);
  });
});
