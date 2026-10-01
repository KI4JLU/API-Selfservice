import type { Locale, NotificationType } from '@api-selfservice/shared';
import { formatCostCenter } from '@api-selfservice/shared';

type Vars = Record<string, string | number | null | undefined>;

interface Template {
  subject: string;
  body: string;
}

const T: Record<NotificationType, Record<Locale, Template>> = {
  cost_center_request_created: {
    de: {
      subject: 'Neuer Kostenstellenantrag: {{number}}',
      body: '{{userName}} ({{userEmail}}) hat die Kostenstelle {{number}} „{{name}}“ beantragt.\nVerantwortlich: {{ownerName}} <{{ownerEmail}}>\n\nPrüfen: {{appUrl}}/admin/cost-centers',
    },
    en: {
      subject: 'New cost center request: {{number}}',
      body: '{{userName}} ({{userEmail}}) requested cost center {{number}} “{{name}}”.\nOwner: {{ownerName}} <{{ownerEmail}}>\n\nReview: {{appUrl}}/admin/cost-centers',
    },
  },
  cost_center_request_approved: {
    de: {
      subject: 'Kostenstelle {{number}} freigegeben',
      body: 'Ihr Antrag für die Kostenstelle {{number}} „{{name}}“ wurde freigegeben. Sie sind Mitglied und können API-Keys auf diese Kostenstelle anlegen. Verantwortlich und Kostenstellen-Admin: {{ownerName}}.\n\n{{appUrl}}/keys',
    },
    en: {
      subject: 'Cost center {{number}} approved',
      body: 'Your request for cost center {{number}} “{{name}}” was approved. You are a member and can create API keys on this cost center. Owner and cost center admin: {{ownerName}}.\n\n{{appUrl}}/keys',
    },
  },
  cost_center_request_rejected: {
    de: { subject: 'Kostenstelle {{number}} abgelehnt', body: 'Ihr Antrag für die Kostenstelle {{number}} „{{name}}“ wurde abgelehnt.\nBegründung: {{reason}}\n\n{{appUrl}}/profile' },
    en: { subject: 'Cost center {{number}} rejected', body: 'Your request for cost center {{number}} “{{name}}” was rejected.\nReason: {{reason}}\n\n{{appUrl}}/profile' },
  },
  cost_center_member_added: {
    de: {
      subject: 'Kostenstelle {{number}}: Sie wurden hinzugefügt',
      body: '{{actorName}} hat Sie zur Kostenstelle {{number}} „{{name}}“ hinzugefügt. Sie können jetzt API-Keys auf diese Kostenstelle anlegen.\n\n{{appUrl}}/keys',
    },
    en: {
      subject: 'Cost center {{number}}: you were added',
      body: '{{actorName}} added you to cost center {{number}} “{{name}}”. You can now create API keys on this cost center.\n\n{{appUrl}}/keys',
    },
  },
  cost_center_member_removed: {
    de: {
      subject: 'Kostenstelle {{number}}: Mitgliedschaft beendet',
      body: '{{actorName}} hat Sie aus der Kostenstelle {{number}} „{{name}}“ entfernt. Ihre API-Keys auf dieser Kostenstelle wurden gesperrt.\n\n{{appUrl}}/keys',
    },
    en: {
      subject: 'Cost center {{number}}: membership ended',
      body: '{{actorName}} removed you from cost center {{number}} “{{name}}”. Your API keys on this cost center were blocked.\n\n{{appUrl}}/keys',
    },
  },
  user_budget_80: {
    de: { subject: 'Budget zu {{percent}} % verbraucht', body: 'Sie haben {{spend}} EUR von {{budget}} EUR Ihres Budgets verbraucht ({{percent}} %).\n\n{{appUrl}}/' },
    en: { subject: 'Budget {{percent}} % used', body: 'You have used {{spend}} EUR of your {{budget}} EUR budget ({{percent}} %).\n\n{{appUrl}}/' },
  },
  user_budget_100: {
    de: { subject: 'Budget erschöpft', body: 'Ihr Budget von {{budget}} EUR ist erschöpft. Ihre API-Keys wurden gesperrt, bis ein neuer Budgetzeitraum beginnt oder ein Admin das Budget erhöht.\n\n{{appUrl}}/' },
    en: { subject: 'Budget exhausted', body: 'Your budget of {{budget}} EUR is exhausted. Your API keys were blocked until a new budget period starts or an admin raises the budget.\n\n{{appUrl}}/' },
  },
  cost_center_budget_80: {
    de: { subject: 'Kostenstelle {{number}}: Budget zu {{percent}} % verbraucht', body: 'Die Kostenstelle {{number}} „{{name}}“ hat {{spend}} EUR von {{budget}} EUR verbraucht ({{percent}} %).\n\n{{appUrl}}/cost-centers' },
    en: { subject: 'Cost center {{number}}: budget {{percent}} % used', body: 'Cost center {{number}} “{{name}}” has used {{spend}} EUR of {{budget}} EUR ({{percent}} %).\n\n{{appUrl}}/cost-centers' },
  },
  cost_center_budget_100: {
    de: { subject: 'Kostenstelle {{number}}: Budget erschöpft', body: 'Das Budget der Kostenstelle {{number}} „{{name}}“ ({{budget}} EUR) ist erschöpft. Alle Keys dieser Kostenstelle wurden gesperrt.\n\n{{appUrl}}/cost-centers' },
    en: { subject: 'Cost center {{number}}: budget exhausted', body: 'The budget of cost center {{number}} “{{name}}” ({{budget}} EUR) is exhausted. All keys of this cost center were blocked.\n\n{{appUrl}}/cost-centers' },
  },
  key_expires_14d: {
    de: { subject: 'API-Key „{{keyName}}“ läuft in 14 Tagen ab', body: 'Ihr API-Key „{{keyName}}“ läuft am {{expiresAt}} ab. Sie können ihn im Portal verlängern.\n\n{{appUrl}}/keys' },
    en: { subject: 'API key “{{keyName}}” expires in 14 days', body: 'Your API key “{{keyName}}” expires on {{expiresAt}}. You can extend it in the portal.\n\n{{appUrl}}/keys' },
  },
  key_expires_1d: {
    de: { subject: 'API-Key „{{keyName}}“ läuft morgen ab', body: 'Ihr API-Key „{{keyName}}“ läuft am {{expiresAt}} ab. Verlängern Sie ihn jetzt.\n\n{{appUrl}}/keys' },
    en: { subject: 'API key “{{keyName}}” expires tomorrow', body: 'Your API key “{{keyName}}” expires on {{expiresAt}}. Extend it now.\n\n{{appUrl}}/keys' },
  },
  key_expired: {
    de: { subject: 'API-Key „{{keyName}}“ abgelaufen', body: 'Ihr API-Key „{{keyName}}“ ist abgelaufen und wurde gesperrt. Sie können ihn im Portal verlängern.\n\n{{appUrl}}/keys' },
    en: { subject: 'API key “{{keyName}}” expired', body: 'Your API key “{{keyName}}” expired and was blocked. You can extend it in the portal.\n\n{{appUrl}}/keys' },
  },
  budget_exhausted_keys_blocked: {
    de: { subject: 'Keys gesperrt: Budget erschöpft', body: '{{detail}}\n\n{{appUrl}}/' },
    en: { subject: 'Keys blocked: budget exhausted', body: '{{detail}}\n\n{{appUrl}}/' },
  },
  account_invalid_deactivated: {
    de: { subject: 'Account deaktiviert', body: 'Der Account {{userEmail}} ist laut Keycloak nicht mehr gültig. Login und alle API-Keys wurden gesperrt.' },
    en: { subject: 'Account deactivated', body: 'Account {{userEmail}} is no longer valid according to Keycloak. Login and all API keys were blocked.' },
  },
  user_deactivated: {
    de: { subject: 'Account deaktiviert', body: 'Der Account {{userEmail}} wurde von einem Administrator deaktiviert. Login und alle API-Keys sind gesperrt.' },
    en: { subject: 'Account deactivated', body: 'Account {{userEmail}} was deactivated by an administrator. Login and all API keys are blocked.' },
  },
  deletion_due: {
    de: { subject: 'Löschfrist erreicht: {{userEmail}}', body: 'Der Account {{userEmail}} ist seit {{deletedAt}} deaktiviert. Die Löschfrist ist erreicht. Bitte prüfen Sie die endgültige Löschung.\n\n{{appUrl}}/admin/users' },
    en: { subject: 'Deletion due: {{userEmail}}', body: 'Account {{userEmail}} has been deactivated since {{deletedAt}}. The retention period is over. Please review final deletion.\n\n{{appUrl}}/admin/users' },
  },
  role_changed: {
    de: { subject: 'Ihre Rolle wurde geändert', body: 'Ihre Rolle im API-Selfservice-Portal ist jetzt: {{role}}.{{detail}}\n\n{{appUrl}}/' },
    en: { subject: 'Your role was changed', body: 'Your role in the API-Selfservice portal is now: {{role}}.{{detail}}\n\n{{appUrl}}/' },
  },
  rebooking_created: {
    de: { subject: 'Umbuchung erzeugt', body: 'Umbuchung für {{periodStart}} bis {{periodEnd}} wurde erzeugt ({{rowCount}} Zeilen, {{total}} EUR).' },
    en: { subject: 'Rebooking created', body: 'Rebooking for {{periodStart}} to {{periodEnd}} was created ({{rowCount}} rows, {{total}} EUR).' },
  },
};

function fill(s: string, vars: Vars): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function renderMail(type: NotificationType, locale: Locale, vars: Vars): { subject: string; text: string } {
  const t = T[type][locale];
  const v = { ...vars };
  if (typeof v.number === 'string' && v.number.length === 8) v.number = formatCostCenter(v.number);
  return { subject: fill(t.subject, v), text: fill(t.body, v) };
}
