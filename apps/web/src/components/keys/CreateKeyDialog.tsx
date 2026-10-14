import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DEFAULT_COST_CENTER, type KeyBudgetPeriod } from '@api-selfservice/shared';
import { useCreateKey, useProviders, type CreatedApiKey, type Me, type Provider } from '@/lib/queries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, RequiredMark } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TierBadge } from '@/components/StatusBadge';
import { ModelPrice } from '@/components/ModelPrice';
import { Banner } from '@/components/ui/page';
import { endOfLocalDay, localDateInput } from '@/lib/format';
import { KeyExpiryField } from './KeyExpiry';

export function CreateKeyDialog({ open, onOpenChange, me, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me; onCreated: (k: CreatedApiKey) => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [costCenterId, setCostCenterId] = useState(me.costCenter.id);
  const [models, setModels] = useState<string[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<KeyBudgetPeriod | 'once'>('monthly');
  // #11: valid until, by default the longest allowed validity
  const maxExpiry = localDateInput(new Date(), me.keyLifetimeDays);
  const [expiry, setExpiry] = useState(maxExpiry);
  const providers = useProviders(costCenterId);
  const create = useCreateKey();

  useEffect(() => {
    if (open) {
      setName('');
      setCostCenterId(me.costCenter.id);
      setModels([]);
      setSelectedProviders([]);
      setFilter('');
      setOpenGroups(new Set());
      setBudget('');
      setBudgetPeriod('monthly');
      setExpiry(localDateInput(new Date(), me.keyLifetimeDays));
    }
  }, [open, me.costCenter.id, me.keyLifetimeDays]);

  useEffect(() => {
    // Drop models and providers that are no longer offered for the selected cost center.
    if (providers.data) {
      setModels((m) => m.filter((x) => providers.data.some((p) => p.modelName === x)));
      setSelectedProviders((s) => s.filter((x) => providers.data.some((p) => p.provider === x)));
    }
  }, [providers.data]);

  // One collapsible group per provider; models without a provider come last.
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
  const needle = filter.trim().toLowerCase();
  const toggleGroup = (name: string) =>
    setOpenGroups((o) => {
      const n = new Set(o);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  // F-KEY-10: releasing a provider gives the key all its current and future models, so single models of it are dropped.
  const setProviderReleased = (name: string, items: Provider[], on: boolean) => {
    setSelectedProviders((s) => (on ? [...new Set([...s, name])] : s.filter((x) => x !== name)));
    if (on) setModels((m) => m.filter((x) => !items.some((p) => p.modelName === x)));
  };
  // Without any offered model no key can be created (e.g. no free model for the default cost center).
  const noModels = providers.isSuccess && providers.data.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (models.length === 0 && selectedProviders.length === 0) {
      toast.error(t('keys.selectModel'));
      return;
    }
    const b = budget.trim() === '' ? null : Number(budget);
    const period = b === null || budgetPeriod === 'once' ? null : budgetPeriod;
    const created = await create
      .mutateAsync({ name: name.trim(), costCenterId, models, providers: selectedProviders, budget: b, budgetPeriod: period, expiresAt: endOfLocalDay(expiry) })
      .catch(() => null);
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
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t('keys.models')}
                <RequiredMark />
              </span>
              <span className="text-xs text-muted-foreground" data-testid="key-selection-summary">
                {t('keys.selectionSummary', { providers: selectedProviders.length, models: models.length })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t('keys.providersHint')}</p>
            {isDefaultCc ? (
              <Banner variant="info" testId="hint-paid-models">
                {t('keys.paidRequiresCostCenter')}
              </Banner>
            ) : null}
            {noModels ? (
              <Banner variant="warning" testId="hint-no-models">
                {t('keys.noModelsAvailable')}
              </Banner>
            ) : null}
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('costCenters.modelsFilter')} className="h-8" data-testid="input-key-models-filter" />
            <div className="max-h-72 overflow-y-auto rounded-md border" data-testid="list-models">
              {providers.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : (providers.data ?? []).length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">{t('common.empty')}</div>
              ) : (
                modelGroups.map((g) => {
                  const key = g.name ?? '';
                  const items = needle ? g.items.filter((p) => `${p.modelName} ${p.displayNameDe ?? ''} ${p.displayNameEn ?? ''} ${key}`.toLowerCase().includes(needle)) : g.items;
                  if (!items.length) return null;
                  const released = g.name !== null && selectedProviders.includes(g.name);
                  const picked = g.items.filter((p) => models.includes(p.modelName)).length;
                  const expanded = !!needle || openGroups.has(key);
                  const label = g.name ?? t('providers.noProvider');
                  return (
                    <div key={key} className="border-b last:border-0" data-testid={`model-group-${g.name ?? 'none'}`}>
                      <div className="bg-muted sticky top-0 z-10 flex items-center gap-3 px-3 py-1.5 text-sm font-medium">
                        {g.name !== null ? (
                          <Checkbox
                            checked={released ? true : picked > 0 ? 'indeterminate' : false}
                            onCheckedChange={() => setProviderReleased(g.name!, g.items, !released)}
                            disabled={!g.items.some((p) => p.available)}
                            aria-label={t('keys.releaseProvider', { provider: label })}
                            data-testid={`provider-${g.name}`}
                          />
                        ) : (
                          <span className="size-4" />
                        )}
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-2 text-left"
                          onClick={() => toggleGroup(key)}
                          aria-expanded={expanded}
                          data-testid={`btn-model-group-${g.name ?? 'none'}`}
                        >
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {label}
                          <span className="text-xs font-normal text-muted-foreground">
                            {released ? t('keys.providerAllModels') : t('keys.providerPicked', { count: picked, total: g.items.length })}
                          </span>
                        </button>
                      </div>
                      {expanded
                        ? items.map((p) => {
                            const display = (lang === 'en' ? p.displayNameEn : p.displayNameDe) ?? null;
                            const desc = (lang === 'en' ? p.descriptionEn : p.descriptionDe) ?? null;
                            return (
                              <label key={p.id} className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 border-t py-2 pr-3 pl-10" data-testid={`model-${p.modelName}`}>
                                <Checkbox
                                  className="mt-0.5"
                                  checked={released || models.includes(p.modelName)}
                                  disabled={!p.available || released}
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
                          })
                        : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <KeyExpiryField id="key-expires" value={expiry} onChange={setExpiry} max={maxExpiry} testId="input-key-expires" />
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
            <Button type="submit" loading={create.isPending} disabled={noModels} data-testid="btn-submit-create-key">
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
