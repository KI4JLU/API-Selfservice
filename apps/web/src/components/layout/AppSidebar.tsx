import type { ComponentProps } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import type { Me } from '@/lib/queries';
import { isNavItemActive, navFor, type NavItem } from '@/lib/nav';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { NavUser } from './NavUser';

function NavMenuItem({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const { setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const label = t(item.labelKey);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isNavItemActive(item, pathname)} tooltip={label}>
        <Link to={item.to} data-testid={item.testId} onClick={() => setOpenMobile(false)}>
          <item.icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ me, ...props }: { me: Me } & ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();
  const { setOpenMobile } = useSidebar();
  const nav = navFor(me);
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link to="/" data-testid="nav-home" onClick={() => setOpenMobile(false)}>
                <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
                  <KeyRound className="size-3.5" />
                </span>
                <span className="text-base font-semibold">{t('app.name')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Main">
              {nav.user.map((item) => (
                <NavMenuItem key={item.to} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {nav.admin.length ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t('nav.admin')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu aria-label={t('nav.admin')}>
                {nav.admin.map((item) => (
                  <NavMenuItem key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser me={me} />
        <div className="text-muted-foreground px-2 text-xs" data-testid="app-version">
          v{__APP_VERSION__}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
