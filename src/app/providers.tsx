'use client';

/**
 * App-root client-state providers (D-14). Mounted in layout.js ABOVE any
 * component that calls useQuery. Kept as a separate 'use client' island so
 * layout.js stays a server component.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { getQueryClient } from '@/lib/queryClient';

export default function Providers({ children }: { children: React.ReactNode }) {
  // NOT useState — getQueryClient() already returns a server-fresh / browser-singleton client.
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV !== 'production' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
