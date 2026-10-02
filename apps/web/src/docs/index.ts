import generalDe from './de/general.md?raw';
import generalEn from './en/general.md?raw';
import dashboardDe from './de/dashboard.md?raw';
import dashboardEn from './en/dashboard.md?raw';
import keysDe from './de/keys.md?raw';
import keysEn from './en/keys.md?raw';
import keyTestDe from './de/key-test.md?raw';
import keyTestEn from './en/key-test.md?raw';
import requestsDe from './de/requests.md?raw';
import requestsEn from './en/requests.md?raw';
import profileDe from './de/profile.md?raw';
import profileEn from './en/profile.md?raw';
import costCentersDe from './de/cost-centers.md?raw';
import costCentersEn from './en/cost-centers.md?raw';
import adminUsersDe from './de/admin-users.md?raw';
import adminUsersEn from './en/admin-users.md?raw';
import adminLitellmUsersDe from './de/admin-litellm-users.md?raw';
import adminLitellmUsersEn from './en/admin-litellm-users.md?raw';
import adminCostCentersDe from './de/admin-cost-centers.md?raw';
import adminCostCentersEn from './en/admin-cost-centers.md?raw';
import adminProvidersDe from './de/admin-providers.md?raw';
import adminProvidersEn from './en/admin-providers.md?raw';
import adminReportsDe from './de/admin-reports.md?raw';
import adminReportsEn from './en/admin-reports.md?raw';
import adminNotificationsDe from './de/admin-notifications.md?raw';
import adminNotificationsEn from './en/admin-notifications.md?raw';
import adminEventsDe from './de/admin-events.md?raw';
import adminEventsEn from './en/admin-events.md?raw';

export interface HelpSection {
  id: string;
  titleKey: string;
  adminOnly?: boolean;
  md: { de: string; en: string };
}

export const helpSections: HelpSection[] = [
  { id: 'general', titleKey: 'help.sections.general', md: { de: generalDe, en: generalEn } },
  { id: 'dashboard', titleKey: 'nav.dashboard', md: { de: dashboardDe, en: dashboardEn } },
  { id: 'keys', titleKey: 'nav.keys', md: { de: keysDe, en: keysEn } },
  { id: 'key-test', titleKey: 'nav.keyTest', md: { de: keyTestDe, en: keyTestEn } },
  { id: 'requests', titleKey: 'nav.requests', md: { de: requestsDe, en: requestsEn } },
  { id: 'profile', titleKey: 'nav.profile', md: { de: profileDe, en: profileEn } },
  { id: 'cost-centers', titleKey: 'nav.myCostCenters', md: { de: costCentersDe, en: costCentersEn } },
  { id: 'admin-users', titleKey: 'help.sections.adminUsers', adminOnly: true, md: { de: adminUsersDe, en: adminUsersEn } },
  { id: 'admin-litellm-users', titleKey: 'help.sections.adminLitellmUsers', adminOnly: true, md: { de: adminLitellmUsersDe, en: adminLitellmUsersEn } },
  { id: 'admin-cost-centers', titleKey: 'help.sections.adminCostCenters', adminOnly: true, md: { de: adminCostCentersDe, en: adminCostCentersEn } },
  { id: 'admin-providers', titleKey: 'help.sections.adminProviders', adminOnly: true, md: { de: adminProvidersDe, en: adminProvidersEn } },
  { id: 'admin-reports', titleKey: 'help.sections.adminReports', adminOnly: true, md: { de: adminReportsDe, en: adminReportsEn } },
  { id: 'admin-notifications', titleKey: 'help.sections.adminNotifications', adminOnly: true, md: { de: adminNotificationsDe, en: adminNotificationsEn } },
  { id: 'admin-events', titleKey: 'help.sections.adminEvents', adminOnly: true, md: { de: adminEventsDe, en: adminEventsEn } },
];
