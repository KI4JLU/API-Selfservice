import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { LOCALES, type Locale } from '@api-selfservice/shared';
import { useMe, useUpdateMe } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
});

function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMe();
  const update = useUpdateMe();
  const [locale, setLocale] = useState<Locale>('de');

  useEffect(() => {
    if (me) setLocale(me.locale);
  }, [me]);

  if (!me) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await update.mutateAsync({ locale }).catch(() => null);
    if (!res) return;
    if (locale !== i18n.resolvedLanguage?.slice(0, 2)) await i18n.changeLanguage(locale);
    toast.success(t('profile.saved'));
  };

  return (
    <div data-testid="page-profile" className="mx-auto max-w-2xl">
      <PageHeader title={t('profile.title')} />
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
