import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { LOCALES, type Locale } from '@litelite/shared';
import { useTheme } from '@/lib/theme';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Current UI language and a switcher that also stores the choice in the profile when signed in. */
export function useLanguage(signedIn = false) {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const current = (i18n.resolvedLanguage ?? 'de').slice(0, 2) as Locale;
  const change = async (lng: Locale) => {
    await i18n.changeLanguage(lng);
    if (signedIn) {
      try {
        await api.patch('/me', { locale: lng });
        void qc.invalidateQueries({ queryKey: qk.me });
      } catch {
        /* ignore; the UI language is already switched locally */
      }
    }
  };
  return { current, change };
}

export function LanguageSwitch({ signedIn = false }: { signedIn?: boolean }) {
  const { t } = useTranslation();
  const { current, change } = useLanguage(signedIn);
  return (
    <div className="bg-muted text-muted-foreground inline-flex h-9 items-center rounded-lg p-[3px]" role="group" aria-label={t('common.language')}>
      {LOCALES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => change(lng)}
          data-testid={`btn-lang-${lng}`}
          aria-pressed={current === lng}
          className={cn(
            'inline-flex h-full items-center justify-center rounded-md border border-transparent px-2.5 text-xs font-medium uppercase transition-[color,box-shadow]',
            current === lng ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30' : 'hover:text-foreground',
          )}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, toggle] = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} data-testid="btn-theme" aria-label={theme === 'dark' ? t('common.themeLight') : t('common.themeDark')} title={t('common.theme')}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}
