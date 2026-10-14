import { useTranslation } from 'react-i18next';
import { SAP_RECIPIENT_TYPES, type SapRecipientType } from '@api-selfservice/shared';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';

export type SapRecipientValue = { type: SapRecipientType; number: string };

/** #14: a cost center starts with 1 or 2, a project with 6 or 8; always 8 digits. */
export function sapRecipientValid(v: SapRecipientValue) {
  return /^\d{8}$/.test(v.number) && (v.type === 'cost_center' ? /^[12]/ : /^[68]/).test(v.number);
}

/** #14: required SAP recipient of a portal cost center (KoSt_neu or Auftrag_neu in the SAP export). */
export function SapRecipientFields({ value, onChange, idPrefix }: { value: SapRecipientValue; onChange: (v: SapRecipientValue) => void; idPrefix: string }) {
  const { t } = useTranslation();
  const invalid = value.number !== '' && !sapRecipientValid(value);
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="sap-recipient">
      <Field label={t('sap.recipientType')} htmlFor={`${idPrefix}-sap-type`} required>
        <SimpleSelect
          id={`${idPrefix}-sap-type`}
          value={value.type}
          onValueChange={(v) => onChange({ ...value, type: v as SapRecipientType })}
          options={SAP_RECIPIENT_TYPES.map((x) => ({ value: x, label: t(`sap.recipientTypes.${x}`) }))}
          testId="input-sap-recipient-type"
        />
      </Field>
      <Field label={t('sap.recipientNumber')} htmlFor={`${idPrefix}-sap-number`} required hint={invalid ? undefined : t(`sap.recipientHint.${value.type}`)}>
        <Input
          id={`${idPrefix}-sap-number`}
          required
          inputMode="numeric"
          maxLength={8}
          value={value.number}
          onChange={(e) => onChange({ ...value, number: e.target.value.replace(/\D/g, '') })}
          aria-invalid={invalid}
          data-testid="input-sap-recipient-number"
        />
        {invalid ? <p className="text-destructive text-sm">{t(`sap.recipientInvalid.${value.type}`)}</p> : null}
      </Field>
    </div>
  );
}
