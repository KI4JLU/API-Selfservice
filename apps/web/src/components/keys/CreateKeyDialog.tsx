import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DEFAULT_COST_CENTER, type KeyBudgetPeriod } from '@api-selfservice/shared';
import { useCreateKey, useProviders, type CreatedApiKey, type Me } from '@/lib/queries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, RequiredMark } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TierBadge } from '@/components/StatusBadge';
import { ModelPrice } from '@/components/ModelPrice';
import { Banner } from '@/components/ui/page';

export function CreateKeyDialog({ open, onOpenChange, me, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me; onCreated: (k: CreatedApiKey) => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [costCenterId, setCostCenterId] = useState(me.costCenter.id);
  const [models, setModels] = useState<string[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [tab, setTab] = useState<'models' | 'providers'>('models');
  const [budget, setBudget] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<KeyBudgetPeriod | 'once'>('monthly');
  const providers = useProviders(costCenterId);
  const create = useCreateKey();

  useEffect(() => {
    if (open) {
      setName('');
      setCostCenterId(me.costCenter.id);
      setModels([]);
      setSelectedProviders([]);
      setTab('models');
      setBudget('');
      setBudgetPeriod('monthly');
    }
  }, [open, me.costCenter.id]);

  useEffect(() => {
    // Drop models and providers that are no longer offered for the selected cost center.
    if (providers.data) {
      setModels((m) => m.filter((x) => providers.data.some((p) => p.modelName === x)));
      setSelectedProviders((s) => s.filter((x) => providers.data.some((p) => p.provider === x)));
    }
  }, [providers.data]);

  // F-KEY-10: one entry per provider; the key gets all current and future models of it.
  const providerGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const p of providers.data ?? []) if (p.provider && p.available) groups.set(p.provider, [...(groups.get(p.provider) ?? []), p.modelName]);
    return [...groups.entries()].map(([name, ms]) => ({ name, models: ms })).sort((a, b) => a.name.localeCompare(b.name));
  }, [providers.data]);

  // Models tab grouped by provider; models without a provider come last.
  const modelGroups = useMemo(() => {
    const groups = new Map<string | null, NonNullable<typeof providers.data>>();
    for (const p of providers.data ?? []) groups.set(p.provider, [...(groups.get(p.provider) ?? []), p]);
    return [...groups.entries()].map(([name, items]) => ({ name, items })).sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name)));
  }, [providers.data]);

  // F-KST-12: keys only on the default and on cost centers the user is a member of.
  const ccOptions = useMemo(() => {
    const map = new Map(me.memberCostCenters.map((c) => [c.id, c]));
    if (!map.has(me.costCenter.id)) map.set(me.costCenter.id, { ...me.costCenter, role: 'user' });
    return [...map.values()].map((c) => ({ value: c.id, number: c.number, label: c.name }));
  }, [me.memberCostCenters, me.costCenter]);

  const selectedCc = ccOptions.find((o) => o.value === costCenterId);
  const isDefaultCc = (selectedCc?.number ?? me.costCenter.number) === DEFAULT_COST_CENTER;
  const lang = (i18n.resolvedLanguage ?? 'de').slice(0, 2);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (models.length === 0 && selectedProviders.length === 0) {
      toast.error(t('keys.selectModel'));
      return;
    }
    const b = budget.trim() === '' ? null : Number(budget);
    const period = b === null || budgetPeriod === 'once' ? null : budgetPeriod;
    const created = await create.mutateAsync({ name: name.trim(), costCenterId, models, providers: selectedProviders, budget: b, budgetPeriod: period }).catch(() => null);
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
          <Field label={t('keys.name')} htmlFor="key-name" required>
            <Input id="key-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-key-name" autoFocus />
          </Field>
          <Field label={t('common.costCenter')} htmlFor="key-cc">
            <SimpleSelect id="key-cc" value={costCenterId} onValueChange={setCostCenterId} options={ccOptions} testId="input-key-cost-center" />
          </Field>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'models' | 'providers')} className="gap-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t('keys.models')}
                <RequiredMark />
              </span>
              <span className="text-xs text-muted-foreground">{t('keys.modelsSelected', { count: tab === 'models' ? models.length : selectedProviders.length })}</span>
            </div>
            <TabsList>
              <TabsTrigger value="models" data-testid="tab-models">
                {t('keys.tabModels')}
              </TabsTrigger>
              <TabsTrigger value="providers" data-testid="tab-providers">
                {t('keys.tabProviders')}
              </TabsTrigger>
            </TabsList>
            {isDefaultCc ? (
              <Banner variant="info" testId="hint-paid-models">
                {t('keys.paidRequiresCostCenter')}
              </Banner>
            ) : null}
            <TabsContent value="models" className="rounded-md border" data-testid="list-models">
              {providers.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : (providers.data ?? []).length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">{t('common.empty')}</div>
              ) : (
                modelGroups.map((g) => (
                  <div key={g.name ?? ''} className="border-b last:border-0" data-testid={`model-group-${g.name ?? 'none'}`}>
                    <div className="bg-muted/50 border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">{g.name ?? t('providers.noProvider')}</div>
                    {g.items.map((p) => {
                      const display = (lang === 'en' ? p.displayNameEn : p.displayNameDe) ?? null;
                      const desc = (lang === 'en' ? p.descriptionEn : p.descriptionDe) ?? null;
                      // models of a selected provider are part of the key anyway
                      const covered = p.provider !== null && selectedProviders.includes(p.provider);
                      const checked = covered || models.includes(p.modelName);
                      return (
                        <label key={p.id} className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 border-b px-3 py-2 last:border-0" data-testid={`model-${p.modelName}`}>
                          <Checkbox
                            className="mt-0.5"
                            checked={checked}
                            disabled={!p.available || covered}
                            onCheckedChange={(v) => setModels((m) => (v === true ? [...m, p.modelName] : m.filter((x) => x !== p.modelName)))}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium">{display ?? p.modelName}</span>
                              {display ? <span className="font-mono text-xs text-muted-foreground">{p.modelName}</span> : null}
                              <TierBadge tier={p.tier} />
                            </span>
                            {desc ? <span className="text-xs text-muted-foreground">{desc}</span> : null}
                            <ModelPrice provider={p} />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </TabsContent>
            <TabsContent value="providers" className="grid gap-1.5">
              <p className="text-xs text-muted-foreground">{t('keys.providersHint')}</p>
              <div className="rounded-md border" data-testid="list-providers">
                {providers.isLoading ? (
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-full" />
                  </div>
                ) : providerGroups.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">{t('common.empty')}</div>
                ) : (
                  providerGroups.map((g) => (
                    <label key={g.name} className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 border-b px-3 py-2 last:border-0" data-testid={`provider-${g.name}`}>
                      <Checkbox
                        className="mt-0.5"
                        checked={selectedProviders.includes(g.name)}
                        onCheckedChange={(v) => setSelectedProviders((s) => (v === true ? [...s, g.name] : s.filter((x) => x !== g.name)))}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="text-xs text-muted-foreground">{t('keys.providerModels', { count: g.models.length, models: g.models.join(', ') })}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('keys.budget')} htmlFor="key-budget" hint={t('keys.budgetHint')}>
              <Input id="key-budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('common.unlimited')} data-testid="input-key-budget" />
            </Field>
            {/* F-KEY-11: monthly reset or once for the key's lifetime */}
            <Field label={t('keys.budgetPeriod')} htmlFor="key-budget-period" hint={t('keys.budgetPeriodHint')}>
              <SimpleSelect
                id="key-budget-period"
                value={budgetPeriod}
                onValueChange={(v) => setBudgetPeriod(v as KeyBudgetPeriod | 'once')}
                options={[
                  { value: 'monthly', label: t('period.monthly') },
                  { value: 'once', label: t('keys.budgetOnce') },
                ]}
                disabled={budget.trim() === ''}
                testId="input-key-budget-period"
              />
            </Field>
          </div>
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
