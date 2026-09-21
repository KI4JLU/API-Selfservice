import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Me } from '@/lib/queries';
import { helpSectionForPath } from '@/lib/nav';
import { helpSections } from '@/docs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useHelp } from './AppShell';
import { cn } from '@/lib/utils';

export function HelpSheet({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const { open, setOpen } = useHelp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [section, setSection] = useState(() => helpSectionForPath(pathname));

  useEffect(() => {
    if (open) setSection(helpSectionForPath(pathname));
  }, [open, pathname]);

  const lang = (i18n.resolvedLanguage ?? 'de').slice(0, 2) === 'en' ? 'en' : 'de';
  const visible = helpSections.filter((s) => !s.adminOnly || me.role === 'admin');
  const active = visible.find((s) => s.id === section) ?? visible[0]!;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="sm:max-w-2xl" data-testid="sheet-help">
        <SheetHeader>
          <SheetTitle>{t('help.title')}</SheetTitle>
          <SheetDescription>{t('help.description')}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 md:flex-row">
          <nav className="flex shrink-0 flex-row flex-wrap gap-1 md:w-44 md:flex-col" aria-label={t('help.title')}>
            {visible.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                data-testid={`help-section-${s.id}`}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  s.id === active.id ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {t(s.titleKey)}
              </button>
            ))}
          </nav>
          <article className="markdown min-w-0 flex-1" data-testid="help-content" data-section={active.id}>
            <ReactMarkdown>{active.md[lang]}</ReactMarkdown>
          </article>
        </div>
      </SheetContent>
    </Sheet>
  );
}
