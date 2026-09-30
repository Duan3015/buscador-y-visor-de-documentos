'use client';

import { useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from 'react';
import { useApi } from '../../shared/api/api-context';
import { Button } from '../../shared/ui/button';
import { Field } from '../../shared/ui/field';
import { useStatusStore } from '../notifications/status-events-provider';
import {
  ACCEPT_ATTRIBUTE,
  defaultTitle,
  hasSupportedExtension,
  validateBatch,
  type MetadataErrors,
} from './metadata';
import { UploadQueue } from './upload-queue';
import { UploadRow } from './upload-row';

interface Selected {
  id: number;
  file: File;
  title: string;
}

const NO_ERRORS: MetadataErrors = { titles: {} };

/** Formulario de carga y cola de envios con seguimiento en tiempo real (HU-01, HU-04). */
export function UploadPanel() {
  const api = useApi();
  const store = useStatusStore();
  const queue = useMemo(
    () => new UploadQueue((request) => api.uploadDocument(request), (id) => store.track(id)),
    [api, store],
  );
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  const [selected, setSelected] = useState<Selected[]>([]);
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const [shared, setShared] = useState({ author: '', category: '', tags: '', version: '' });
  const [errors, setErrors] = useState<MetadataErrors>(NO_ERRORS);
  const nextId = useRef(1);

  const busy = items.some((item) => item.state === 'EN_COLA' || item.state === 'ENVIANDO');
  const hasFinished = items.some((item) => item.state === 'ACEPTADO' || item.state === 'RECHAZADO');

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const supported = files.filter((file) => hasSupportedExtension(file.name));
    setRejectedNames(files.filter((file) => !hasSupportedExtension(file.name)).map((file) => file.name));
    setSelected((current) => [
      ...current,
      ...supported.map((file) => ({ id: nextId.current++, file, title: defaultTitle(file.name) })),
    ]);
    setErrors(NO_ERRORS);
    // Permite volver a elegir el mismo archivo despues de quitarlo.
    event.target.value = '';
  };

  const setTitle = (id: number, title: string) =>
    setSelected((current) => current.map((entry) => (entry.id === id ? { ...entry, title } : entry)));

  const remove = (id: number) => setSelected((current) => current.filter((entry) => entry.id !== id));

  const setField = (field: keyof typeof shared) => (event: ChangeEvent<HTMLInputElement>) =>
    setShared((current) => ({ ...current, [field]: event.target.value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Defensa frente al doble envio (E-45): el boton ya esta deshabilitado durante el envio.
    if (busy || selected.length === 0) return;

    const result = validateBatch(
      selected.map((entry) => entry.title),
      shared,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(NO_ERRORS);
    queue.enqueue(selected.map((entry, index) => ({ file: entry.file, metadata: result.metadata[index]! })));
    setSelected([]);
    setRejectedNames([]);
  };

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} className="flex flex-col gap-6 rounded-lg border border-slate-200 bg-white p-6" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="upload-files" className="text-sm font-medium text-slate-700">
            Archivos (TXT, Markdown o PDF)
          </label>
          <input
            id="upload-files"
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            onChange={onFiles}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700"
          />
          {rejectedNames.length > 0 ? (
            <p role="alert" className="text-xs text-red-600">
              Formato no admitido, se omitió: {rejectedNames.join(', ')}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Autor" value={shared.author} onChange={setField('author')} error={errors.author} maxLength={100} required />
          <Field label="Categoría" value={shared.category} onChange={setField('category')} error={errors.category} maxLength={50} required />
          <Field
            label="Etiquetas"
            value={shared.tags}
            onChange={setField('tags')}
            error={errors.tags}
            hint="Separadas por comas (hasta 10)"
          />
          <Field
            label="Versión"
            value={shared.version}
            onChange={setField('version')}
            error={errors.version}
            hint="Opcional: 1, 1.2 o 1.2.3"
          />
        </div>

        {selected.length > 0 ? (
          <ul className="flex flex-col gap-3" aria-label="Archivos seleccionados">
            {selected.map((entry, index) => (
              <li key={entry.id} className="flex items-start gap-3">
                <div className="flex-1">
                  <Field
                    label={`Título de ${entry.file.name}`}
                    value={entry.title}
                    onChange={(event) => setTitle(entry.id, event.target.value)}
                    error={errors.titles[index]}
                    maxLength={200}
                  />
                </div>
                <Button variant="ghost" className="mt-6" onClick={() => remove(entry.id)} aria-label={`Quitar ${entry.file.name}`}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || selected.length === 0}>
            {busy ? 'Enviando...' : `Cargar ${selected.length > 0 ? `(${selected.length})` : ''}`.trim()}
          </Button>
          <p className="text-xs text-slate-500">Los datos de autor, categoría, etiquetas y versión se aplican a todos los archivos.</p>
        </div>
      </form>

      {items.length > 0 ? (
        <section aria-label="Estado de las cargas" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Estado de las cargas</h2>
            {hasFinished ? (
              <Button variant="ghost" onClick={() => queue.clearFinished()}>
                Limpiar resueltas
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
