import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { endOfLocalDay, fmtDate, localDateInput } from '@/lib/format';
import { useRenewKey, useUpdateKey, type ApiKey, type CreatedApiKey } from '@/lib/queries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

/**
 * #11: "valid until" date. Allowed from tomorrow up to `max` (creation + key lifetime); keys are rotated at the
 * latest after that, the server checks the same range.
 */
export function KeyExpiryField({ id, value, onChange, max, testId }: { id: string; value: string; onChange: (v: string) => void; max: string; testId: string }) {
  const { t } = useTranslation();
  return (
    <Field label={t('keys.validUntil')} htmlFor={id} required hint={t('keys.validUntilHint', { date: fmtDate(endOfLocalDay(max)) })}>
      <Input id={id} type="date" required min={localDateInput(new Date(), 1)} max={max} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </Field>
  );
}

/** #11: shorten the expiry, or move it out again up to creation + key lifetime. */
export function KeyExpiryDialog({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateKey();
  const [date, setDate] = useState('');
  useEffect(() => {
    if (apiKey) setDate(localDateInput(apiKey.expiresAt));
  }, [apiKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;
    const res = await update.mutateAsync({ id: apiKey.id, body: { expiresAt: endOfLocalDay(date) } }).catch(() => null);
    if (res) {
      toast.success(t('keys.expiryChanged', { date: fmtDate(res.expiresAt) }), { testId: 'toast-key-expiry-changed' });
      onClose();
    }
  };

  return (
    <Dialog open={!!apiKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-key-expiry" className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('keys.changeExpiry')}</DialogTitle>
            <DialogDescription>{t('keys.changeExpiryHint', { name: apiKey?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          {apiKey ? <KeyExpiryField id="key-expiry" value={date} onChange={setDate} max={localDateInput(apiKey.maxExpiresAt)} testId="input-key-expiry" /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending} data-testid="btn-save-key-expiry">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** #11: replaces extending: a new key with the same settings and a new secret; the old one runs out on its own. */
export function RenewKeyDialog({ apiKey, lifetimeDays, onClose, onRenewed }: { apiKey: ApiKey | null; lifetimeDays: number; onClose: () => void; onRenewed: (k: CreatedApiKey) => void }) {
  const { t } = useTranslation();
  const renew = useRenewKey();
  const max = localDateInput(new Date(), lifetimeDays);
  const [date, setDate] = useState(max);
  const [revokeOld, setRevokeOld] = useState(false);
  useEffect(() => {
    if (apiKey) {
      setDate(max);
      setRevokeOld(false);
    }
  }, [apiKey, max]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;
    const res = await renew.mutateAsync({ id: apiKey.id, body: { expiresAt: endOfLocalDay(date), revokeOld } }).catch(() => null);
    if (res) {
      toast.success(t('keys.renewed'), { testId: 'toast-key-renewed' });
      onClose();
      onRenewed(res);
    }
  };

  const oldStillValid = apiKey && apiKey.status === 'active';
  return (
    <Dialog open={!!apiKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-renew-key" className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('keys.renewTitle', { name: apiKey?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('keys.renewHint')}</DialogDescription>
          </DialogHeader>
          <KeyExpiryField id="renew-expiry" value={date} onChange={setDate} max={max} testId="input-renew-expiry" />
          {oldStillValid ? (
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox className="mt-0.5" checked={revokeOld} onCheckedChange={(v) => setRevokeOld(v === true)} data-testid="checkbox-revoke-old" />
              <span className="grid gap-0.5">
                <span>{t('keys.revokeOld')}</span>
                <span className="text-xs text-muted-foreground">{t('keys.revokeOldHint', { date: fmtDate(apiKey.expiresAt) })}</span>
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={renew.isPending} data-testid="btn-submit-renew-key">
              {t('keys.renew')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
