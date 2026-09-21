import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, LogOut, Moon, Sun, User } from 'lucide-react';
import { LOCALES } from '@litelite/shared';
import type { Me } from '@/lib/queries';
import { profileNav } from '@/lib/nav';
import { signOut } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { useLanguage } from './HeaderControls';

/** User pill in the sidebar footer: profile, language, theme and logout. */
export function NavUser({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lang = useLanguage(true);
  const [theme, toggleTheme] = useTheme();

  const onLogout = async () => {
    try {
      await signOut();
    } finally {
      qc.clear();
      await navigate({ to: '/login', replace: true });
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground" data-testid="btn-user-menu" aria-label={me.name}>
              <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                <User className="size-4" />
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium" data-testid="sidebar-user-name">
                  {me.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">{me.email}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1.5">
                <span className="truncate text-sm font-medium" data-testid="user-name">
                  {me.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">{me.email}</span>
                <span>
                  <Badge variant={me.effectiveRole === 'admin' ? 'default' : me.effectiveRole === 'cost_center_admin' ? 'outline' : 'secondary'} data-testid="user-role" data-role={me.effectiveRole}>
                    {t(`roles.${me.effectiveRole}`)}
                  </Badge>
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setOpenMobile(false);
                void navigate({ to: profileNav.to });
              }}
              data-testid={profileNav.testId}
            >
              <User />
              {t(profileNav.labelKey)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">{t('common.language')}</DropdownMenuLabel>
            {LOCALES.map((lng) => (
              <DropdownMenuItem key={lng} onSelect={() => void lang.change(lng)} data-testid={`btn-lang-${lng}`} aria-checked={lang.current === lng} role="menuitemradio">
                <Check className={cn('size-4', lang.current === lng ? 'opacity-100' : 'opacity-0')} />
                {t(`locale.${lng}`)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">{t('common.theme')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={toggleTheme} data-testid="btn-theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
              {theme === 'dark' ? t('common.themeLight') : t('common.themeDark')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout} data-testid="btn-logout">
              <LogOut />
              {t('nav.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
