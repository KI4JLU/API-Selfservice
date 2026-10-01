import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { LOCALES, normalizeCostCenter, type Locale } from '@api-selfservice/shared';
import { useMe, useUpdateMe } from '@/lib/queries';
import { fmtCostCenter, fmtDate } from '@/lib/format';
import { Banner, PageHeader } from '@/components/ui/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
});

function formatInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMe();
  const update = useUpdateMe();
  const [locale, setLocale] = useState<Locale>('de');
  const [costCenter, setCostCenter] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  useEffect(() => {
    if (!me) return;
    setLocale(me.locale);
    setCostCenter(fmtCostCenter(me.costCenter.number));
    setOwnerName(me.costCenterOwnerName ?? '');
    setOwnerEmail(me.costCenterOwnerEmail ?? '');
  }, [me]);

  if (!me) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeCostCenter(costCenter);
    if (!normalized) {
      toast.error(t('profile.costCenterInvalid'));
      return;
    }
    const changedCc = normalized !== me.costCenter.number;
    const res = await update
      .mutateAsync({
        locale,
        costCenterNumber: changedCc ? normalized : undefined,
        costCenterOwnerName: ownerName.trim() || null,
        costCenterOwnerEmail: ownerEmail.trim() || null,
      })
      .catch(() => null);
    if (!res) return;
    if (locale !== i18n.resolvedLanguage?.slice(0, 2)) await i18n.changeLanguage(locale);
    if (changedCc && res.costCenter.number !== normalized && res.pendingRequest?.number === normalized) {
      toast.success(t('profile.requestCreated', { number: fmtCostCenter(normalized) }), { testId: 'toast-request-created' });
    } else {
      toast.success(t('profile.saved'));
    }
  };

  const req = me.pendingRequest;

  return (
    <div data-testid="page-profile" className="mx-auto max-w-2xl">
      <PageHeader title={t('profile.title')} />
      {req ? (
        <Banner variant={req.status === 'pending' ? 'warning' : req.status === 'rejected' ? 'danger' : 'success'} className="mb-4" testId="banner-request-status">
          <div className="font-medium">
            {t('profile.requestStatus')}:{' '}
            <span data-testid="request-status" data-status={req.status}>
              {t(`status.${req.status}`)}
            </span>
          </div>
          <div className="text-foreground">
            {req.status === 'pending'
              ? t('profile.requestPending', { number: fmtCostCenter(req.number) })
              : req.status === 'rejected'
                ? t('profile.requestRejected', { number: fmtCostCenter(req.number), reason: req.reason ?? '–' })
                : t('profile.requestApproved', { number: fmtCostCenter(req.number) })}
          </div>
          <div className="mt-1 text-xs">
            {req.name} · {fmtDate(req.createdAt)}
          </div>
        </Banner>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.cardTitle')}</CardTitle>
          <CardDescription>{t('profile.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.name')} htmlFor="p-name">
                <Input id="p-name" value={me.name} readOnly data-testid="input-name" />
              </Field>
              <Field label={t('common.email')} htmlFor="p-email">
                <Input id="p-email" value={me.email} readOnly data-testid="input-email" />
              </Field>
            </div>
            <Field label={t('common.language')} htmlFor="p-locale">
              <SimpleSelect id="p-locale" value={locale} onValueChange={(v) => setLocale(v as Locale)} options={LOCALES.map((l) => ({ value: l, label: t(`locale.${l}`) }))} className="sm:w-60" testId="input-locale" />
            </Field>
            <Field label={t('profile.costCenter')} htmlFor="p-cc" required hint={t('profile.costCenterHint')}>
              <Input id="p-cc" required inputMode="numeric" value={costCenter} onChange={(e) => setCostCenter(formatInput(e.target.value))} placeholder="1234 5678" className="font-mono sm:w-60" data-testid="input-cost-center" />
            </Field>
            <div className="text-muted-foreground text-sm">
              {t('profile.currentCostCenter')}: <span className="text-foreground font-medium">{fmtCostCenter(me.costCenter.number)}</span> · {me.costCenter.name}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('profile.ownerName')} htmlFor="p-owner">
                <Input id="p-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={200} data-testid="input-owner-name" />
              </Field>
              <Field label={t('profile.ownerEmail')} htmlFor="p-owner-email">
                <Input id="p-owner-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} data-testid="input-owner-email" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={update.isPending} data-testid="btn-save-profile">
                {t('common.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
