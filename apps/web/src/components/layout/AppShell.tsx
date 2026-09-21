import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteContext } from '@tanstack/react-router';
import { hasStoredLanguage } from '@/lib/i18n';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { SiteHeader } from './SiteHeader';
import { HelpSheet } from './HelpSheet';
import { ImpersonationBanner } from './ImpersonationBanner';

interface HelpCtx {
  open: boolean;
  setOpen: (o: boolean) => void;
}
const HelpContext = createContext<HelpCtx>({ open: false, setOpen: () => {} });
export const useHelp = () => useContext(HelpContext);

/** Sidebar layout after the shadcn "dashboard-01" block: inset sidebar, slim header, content. */
export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useRouteContext({ from: '/_app' });
  const { i18n } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);

  // First visit without a stored language preference: follow the profile locale.
  useEffect(() => {
    if (!hasStoredLanguage() && me.locale !== (i18n.resolvedLanguage ?? '').slice(0, 2)) {
      void i18n.changeLanguage(me.locale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.locale]);

  const ctx = useMemo(() => ({ open: helpOpen, setOpen: setHelpOpen }), [helpOpen]);

  return (
    <HelpContext.Provider value={ctx}>
      <SidebarProvider style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' } as CSSProperties}>
        <AppSidebar me={me} variant="inset" />
        <SidebarInset>
          <SiteHeader />
          <ImpersonationBanner me={me} />
          <div className="flex flex-1 flex-col">
            <div className="w-full px-4 py-6 lg:px-6">{children}</div>
          </div>
        </SidebarInset>
        <HelpSheet me={me} />
      </SidebarProvider>
    </HelpContext.Provider>
  );
}
