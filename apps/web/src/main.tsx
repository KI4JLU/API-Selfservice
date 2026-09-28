import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { toast } from 'sonner';
import './lib/i18n';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './index.css';
import { initTheme } from './lib/theme';
import { isApiError } from './lib/api';
import { errorMessage } from './lib/errors';
import { routeTree } from './routeTree.gen';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 15_000,
      retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
    },
  },
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (isApiError(err) && err.status === 401) {
        // Session gone: the route guard handles /login itself; elsewhere send the user back to the login page.
        if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
        return;
      }
      if (query.meta?.silent) return;
      toast.error(errorMessage(err));
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  }),
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
