import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DEFAULT_COST_CENTER } from '@litelite/shared';
import { useCostCenters, useCreateKey, useProviders, type CreatedApiKey, type Me } from '@/lib/queries';
import { fmtCostCenter } from '@/lib/format';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TierBadge } from '@/components/StatusBadge';
import { ModelPrice } from '@/components/ModelPrice';
import { Banner } from '@/components/ui/page';

export function CreateKeyDialog({ open, onOpenChange, me, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me; onCreated: (k: CreatedApiKey) => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [costCenterId, setCostCenterId] = useState(me.costCenter.id);
  const [models, setModels] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const ccQuery = useCostCenters({ status: 'approved', pageSize: 200 }, open);
  const providers = useProviders(costCenterId);
  const create = useCreateKey();

  useEffect(() => {
    if (open) {
      setName('');
      setCostCenterId(me.costCenter.id);
      setModels([]);
      setBudget('');
    }
  }, [open, me.costCenter.id]);

  useEffect(() => {
    // Drop models that are no longer offered for the selected cost center.
    if (providers.data) setModels((m) => m.filter((x) => providers.data.some((p) => p.modelName === x)));
  }, [providers.data]);

  const ccOptions = useMemo(() => {
    const items = ccQuery.data?.items ?? [];
    const map = new Map(items.map((c) => [c.id, { id: c.id, number: c.number, name: c.name }]));
    if (!map.has(me.costCenter.id)) map.set(me.costCenter.id, me.costCenter);
    return [...map.values()].map((c) => ({ value: c.id, number: c.number, label: `${fmtCostCenter(c.number)} · ${c.name}` }));
  }, [ccQuery.data, me.costCenter]);

  const selectedCc = ccOptions.find((o) => o.value === costCenterId);
  const isDefaultCc = (selectedCc?.number ?? me.costCenter.number) === DEFAULT_COST_CENTER;
  const lang = (i18n.resolvedLanguage ?? 'de').slice(0, 2);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (models.length === 0) {
      toast.error(t('keys.selectModel'));
      return;
    }
    const b = budget.trim() === '' ? null : Number(budget);
    const created = await create.mutateAsync({ name: name.trim(), costCenterId, models, budget: b }).catch(() => null);
    if (created) {
      toast.success(t('keys.created'));
      onOpenChange(false);
      onCreated(created);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-key" className="max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('keys.create')}</DialogTitle>
            <DialogDescription>{t('keys.createHint')}</DialogDescription>
          </DialogHeader>
          <Field label={t('keys.name')} htmlFor="key-name">
            <Input id="key-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-key-name" autoFocus />
          </Field>
          <Field label={t('common.costCenter')} htmlFor="key-cc">
            <SimpleSelect id="key-cc" value={costCenterId} onValueChange={setCostCenterId} options={ccOptions} testId="input-key-cost-center" />
          </Field>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('keys.models')}</span>
              <span className="text-xs text-muted-foreground">{t('keys.modelsSelected', { count: models.length })}</span>
            </div>
            {isDefaultCc ? (
              <Banner variant="info" testId="hint-paid-models">
                {t('keys.paidRequiresCostCenter')}
              </Banner>
            ) : null}
            <div className="rounded-md border" data-testid="list-models">
              {providers.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : (providers.data ?? []).length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">{t('common.empty')}</div>
              ) : (
                (providers.data ?? []).map((p) => {
                  const display = (lang === 'en' ? p.displayNameEn : p.displayNameDe) ?? null;
                  const desc = (lang === 'en' ? p.descriptionEn : p.descriptionDe) ?? null;
                  const checked = models.includes(p.modelName);
                  return (
                    <label key={p.id} className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 border-b px-3 py-2 last:border-0" data-testid={`model-${p.modelName}`}>
                      <Checkbox className="mt-0.5" checked={checked} disabled={!p.available} onCheckedChange={(v) => setModels((m) => (v === true ? [...m, p.modelName] : m.filter((x) => x !== p.modelName)))} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{display ?? p.modelName}</span>
                          {display ? <span className="font-mono text-xs text-muted-foreground">{p.modelName}</span> : null}
                          <TierBadge tier={p.tier} />
                          {p.provider ? <span className="text-muted-foreground text-xs">{p.provider}</span> : null}
                        </span>
                        {desc ? <span className="text-xs text-muted-foreground">{desc}</span> : null}
                        <ModelPrice provider={p} />
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <Field label={t('keys.budget')} htmlFor="key-budget" hint={t('keys.budgetHint')}>
            <Input id="key-budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('common.unlimited')} data-testid="input-key-budget" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} data-testid="btn-submit-create-key">
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
