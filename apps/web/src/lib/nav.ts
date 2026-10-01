import { Activity, Boxes, Building2, ChartColumn, Database, FlaskConical, KeyRound, LayoutDashboard, Mail, ScrollText, User, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { Me } from './queries';

export interface NavItem {
  to: string;
  labelKey: string;
  testId: string;
  helpSection: string;
  icon: LucideIcon;
}

export const userNav: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', testId: 'nav-dashboard', helpSection: 'dashboard', icon: LayoutDashboard },
  { to: '/keys', labelKey: 'nav.keys', testId: 'nav-keys', helpSection: 'keys', icon: KeyRound },
  { to: '/key-test', labelKey: 'nav.keyTest', testId: 'nav-key-test', helpSection: 'key-test', icon: FlaskConical },
  { to: '/requests', labelKey: 'nav.requests', testId: 'nav-requests', helpSection: 'requests', icon: ScrollText },
];

/** Reached via the user menu in the sidebar footer, not via the main navigation. */
export const profileNav: NavItem = { to: '/profile', labelKey: 'nav.profile', testId: 'nav-profile', helpSection: 'profile', icon: User };

export const costCenterAdminNav: NavItem[] = [
  { to: '/cost-centers', labelKey: 'nav.myCostCenters', testId: 'nav-cost-centers', helpSection: 'cost-centers', icon: Wallet },
];

export const adminNav: NavItem[] = [
  { to: '/admin/users', labelKey: 'nav.adminUsers', testId: 'nav-admin-users', helpSection: 'admin-users', icon: Users },
  { to: '/admin/litellm-users', labelKey: 'nav.adminLitellmUsers', testId: 'nav-admin-litellm-users', helpSection: 'admin-litellm-users', icon: Database },
  { to: '/admin/cost-centers', labelKey: 'nav.adminCostCenters', testId: 'nav-admin-cost-centers', helpSection: 'admin-cost-centers', icon: Building2 },
  { to: '/admin/providers', labelKey: 'nav.adminProviders', testId: 'nav-admin-providers', helpSection: 'admin-providers', icon: Boxes },
  { to: '/admin/reports', labelKey: 'nav.adminReports', testId: 'nav-admin-reports', helpSection: 'admin-reports', icon: ChartColumn },
  { to: '/admin/notifications', labelKey: 'nav.adminNotifications', testId: 'nav-admin-notifications', helpSection: 'admin-notifications', icon: Mail },
  { to: '/admin/events', labelKey: 'nav.adminEvents', testId: 'nav-admin-events', helpSection: 'admin-events', icon: Activity },
];

export function navFor(me: Me) {
  // F-KST-8: only users assigned as cost center admin, admins included, see "My cost centers".
  const managesCostCenters = me.managedCostCenters.length > 0;
  return {
    user: [...userNav, ...(managesCostCenters ? costCenterAdminNav : [])],
    admin: me.role === 'admin' ? adminNav : [],
  };
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(item.to + '/');
}

/** The nav item (including the profile) that owns the given path, if any. */
export function navItemForPath(pathname: string): NavItem | undefined {
  return [...adminNav, ...costCenterAdminNav, ...userNav, profileNav].find((n) => isNavItemActive(n, pathname));
}

export function helpSectionForPath(pathname: string): string {
  return navItemForPath(pathname)?.helpSection ?? 'general';
}
