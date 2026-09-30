'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { StatusEventsProvider } from '../features/notifications/status-events-provider';
import { ApiProvider, createDefaultApiClient } from '../shared/api/api-context';
import { ApiError } from '../shared/api/client';
import { ToastProvider } from '../shared/ui/toast';

const MAX_RETRIES = 2;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Un error de la API (4xx) no se arregla reintentando; un fallo de red o un 5xx si.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < MAX_RETRIES;
        },
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [api] = useState(createDefaultApiClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <StatusEventsProvider>
          <ToastProvider>{children}</ToastProvider>
        </StatusEventsProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
