import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { navItemForPath } from '@/lib/nav';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useHelp } from './AppShell';

/** Slim top bar: sidebar toggle, current screen title, help. */
export function SiteHeader() {
  const { t } = useTranslation();
  const help = useHelp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = navItemForPath(pathname);
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" data-testid="btn-sidebar-toggle" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium" data-testid="site-title">
          {current ? t(current.labelKey) : t('app.name')}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => help.setOpen(true)} data-testid="btn-help" aria-label={t('help.open')} title={t('help.open')}>
            <CircleHelp />
          </Button>
        </div>
      </div>
    </header>
  );
}
