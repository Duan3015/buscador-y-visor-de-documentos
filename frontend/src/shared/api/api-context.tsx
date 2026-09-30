'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from './client';

const DEFAULT_API_URL = 'http://localhost:3001/api';

const ApiContext = createContext<ApiClient | null>(null);

/** Cliente con la URL publica configurada en `NEXT_PUBLIC_API_URL`. */
export function createDefaultApiClient(): ApiClient {
  return createApiClient(process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL);
}

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi debe usarse dentro de ApiProvider');
  return client;
}
