import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BUDGET_PERIODS, type BudgetPeriod } from '@api-selfservice/shared';
import { useAdminProviders, useUpdateCostCenter, type CostCenter } from '@/lib/queries';
import { fmtCostCenter, toDateInput } from '@/lib/format';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { TierBadge } from '@/components/StatusBadge';
import { OwnerPicker, type Owner } from '@/components/admin/OwnerPicker';

export function BudgetFields({
  amount,
  setAmount,
  period,
  setPeriod,
  start,
  setStart,
  end,
  setEnd,
  amountLabel,
  required,
  idPrefix = 'b',
}: {
  amount: string;
  setAmount: (v: string) => void;
  period: BudgetPeriod;
  setPeriod: (v: BudgetPeriod) => void;
  start: string;
  setStart: (v: string) => void;
  end: string;
  setEnd: (v: string) => void;
  amountLabel: string;
  required?: boolean;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={amountLabel} htmlFor={`${idPrefix}-amount`} required={required} hint={required ? undefined : t('costCenters.maxBudgetHint')}>
          <Input
            id={`${idPrefix}-amount`}
            type="number"
            min={0}
            step="0.01"
            required={required}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={required ? '' : t('common.unlimited')}
            data-testid="input-budget-amount"
          />
        </Field>
        <Field label={t('common.period')} htmlFor={`${idPrefix}-period`}>
          <SimpleSelect
            id={`${idPrefix}-period`}
            value={period}
            onValueChange={(v) => setPeriod(v as BudgetPeriod)}
            options={BUDGET_PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))}
            testId="input-budget-period"
          />
        </Field>
      </div>
      {period === 'project' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.from')} htmlFor={`${idPrefix}-start`} required>
            <Input id={`${idPrefix}-start`} type="date" required value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-budget-start" />
          </Field>
          <Field label={t('common.to')} htmlFor={`${idPrefix}-end`} required>
            <Input id={`${idPrefix}-end`} type="date" required value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-budget-end" />
          </Field>
        </div>
      ) : null}
    </>
  );
}

/**
 * F-KST-15: models released for a cost center; none selected = all models (also future ones).
 * Grouped by provider (collapsed by default): the provider checkbox selects or clears all of its current models.
 * Fills the remaining dialog height; only the list scrolls.
 */
function ModelRelease({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const providers = useAdminProviders();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const needle = filter.trim().toLowerCase();
  // Unavailable models stay visible while selected, so they can be removed.
  const items = (providers.data ?? []).filter((p) => p.available || value.includes(p.modelName));
  const byProvider = new Map<string, typeof items>();
  for (const p of items) byProvider.set(p.provider ?? '', [...(byProvider.get(p.provider ?? '') ?? []), p]);
  // Models without a provider come last.
  const groups = [...byProvider.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const selected = new Set(value);
  const setGroup = (names: string[], on: boolean) => onChange(on ? [...new Set([...value, ...names])] : value.filter((x) => !names.includes(x)));
  const toggleOpen = (provider: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(provider)) n.delete(provider);
      else n.add(provider);
      return n;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span>
          {t('costCenters.models')}{' '}
          <span className="text-xs font-normal text-muted-foreground">({value.length === 0 ? t('costCenters.modelsAll') : t('keys.modelsSelected', { count: value.length })})</span>
        </span>
        <span className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((p) => p.available).map((p) => p.modelName))} data-testid="btn-cc-models-all">
            {t('costCenters.modelsSelectAll')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])} disabled={!value.length} data-testid="btn-cc-models-none">
            {t('costCenters.modelsSelectNone')}
          </Button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t('costCenters.modelsHint')}</p>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('costCenters.modelsFilter')} className="h-8" data-testid="input-cc-models-filter" />
      <div className="min-h-24 flex-1 overflow-y-auto rounded-md border" data-testid="list-cc-models">
        {groups.map(([provider, all]) => {
          const models = needle ? all.filter((m) => `${m.modelName} ${provider}`.toLowerCase().includes(needle)) : all;
          if (!models.length) return null;
          const names = all.map((m) => m.modelName);
          const count = names.filter((n) => selected.has(n)).length;
          const expanded = !!needle || open.has(provider);
          return (
            <div key={provider || '-'} data-testid={`cc-provider-${provider || 'none'}`}>
              <div className="bg-muted sticky top-0 z-10 flex items-center gap-3 border-b px-3 py-1.5 text-sm font-medium">
                <Checkbox
                  checked={count === 0 ? false : count === names.length ? true : 'indeterminate'}
                  onCheckedChange={() => setGroup(names, count < names.length)}
                  aria-label={provider || t('providers.noProvider')}
                />
                <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={() => toggleOpen(provider)} aria-expanded={expanded} data-testid="btn-cc-provider-toggle">
                  {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  {provider || t('providers.noProvider')}
                  <span className="text-xs font-normal text-muted-foreground">
                    {count}/{names.length}
                  </span>
                </button>
              </div>
              {expanded
                ? models.map((p) => (
                    <label key={p.id} className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b py-1.5 pr-3 pl-10 last:border-0" data-testid={`cc-model-${p.modelName}`}>
                      <Checkbox checked={selected.has(p.modelName)} onCheckedChange={(v) => setGroup([p.modelName], v === true)} />
                      <span className="font-mono text-xs">{p.modelName}</span>
                      <TierBadge tier={p.tier} />
                    </label>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function periodDates(period: BudgetPeriod, start: string, end: string) {
  if (period !== 'project') return { periodStart: null, periodEnd: null };
  return {
    periodStart: start ? new Date(`${start}T00:00:00.000Z`).toISOString() : null,
    periodEnd: end ? new Date(`${end}T00:00:00.000Z`).toISOString() : null,
  };
}

/** Edit a cost center. `full` (admin) also edits name, owner and released models; otherwise only the max budget. */
export function CostCenterEditDialog({ costCenter, onClose, full }: { costCenter: CostCenter | null; onClose: () => void; full?: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateCostCenter();
  const [name, setName] = useState('');
  const [owner, setOwner] = useState<Owner | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!costCenter) return;
    setName(costCenter.name);
    // Unlinked owners (legacy data) show as missing until an admin picks a LiteLLM user.
    setOwner(costCenter.ownerUserId ? { userId: costCenter.ownerUserId, name: costCenter.ownerName, email: costCenter.ownerEmail } : null);
    setModels(costCenter.models);
    setAmount(costCenter.maxBudget === null ? '' : String(costCenter.maxBudget));
    setPeriod(costCenter.budgetPeriod ?? 'monthly');
    setStart(toDateInput(costCenter.periodStart));
    setEnd(toDateInput(costCenter.periodEnd));
  }, [costCenter]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!costCenter) return;
    const maxBudget = amount.trim() === '' ? null : Number(amount);
    const body = {
      ...(full ? { name: name.trim(), models, ...(owner && owner.userId !== costCenter.ownerUserId ? { ownerUserId: owner.userId } : {}) } : {}),
      maxBudget,
      budgetPeriod: maxBudget === null ? null : period,
      ...(maxBudget === null ? { periodStart: null, periodEnd: null } : periodDates(period, start, end)),
    };
    const res = await update.mutateAsync({ id: costCenter.id, body }).catch(() => null);
    if (res) {
      toast.success(t('costCenters.saved'));
      onClose();
    }
  };

  return (
    <Dialog open={!!costCenter} onOpenChange={(o) => !o && onClose()}>
      {/* Admin view: fixed max height, the model list takes the remaining space and scrolls on its own. */}
      <DialogContent className={full ? 'flex max-h-[90svh] flex-col overflow-y-auto sm:max-w-3xl' : undefined} data-testid="dialog-edit-cost-center">
        <form onSubmit={submit} className={full ? 'flex min-h-0 flex-1 flex-col gap-4' : 'grid gap-4'}>
          <DialogHeader>
            <DialogTitle>{t('costCenters.edit')}</DialogTitle>
            <DialogDescription>{costCenter ? `${fmtCostCenter(costCenter.number)} · ${costCenter.name}` : ''}</DialogDescription>
          </DialogHeader>
          {full ? (
            <>
              <Field label={t('costCenters.name')} htmlFor="cc-name" required>
                <Input id="cc-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-cc-name" />
              </Field>
              <OwnerPicker value={owner} onChange={setOwner} idPrefix="cc" />
            </>
          ) : null}
          <BudgetFields
            amount={amount}
            setAmount={setAmount}
            period={period}
            setPeriod={setPeriod}
            start={start}
            setStart={setStart}
            end={end}
            setEnd={setEnd}
            amountLabel={t('costCenters.maxBudget')}
            idPrefix="cc"
          />
          {full ? <ModelRelease value={models} onChange={setModels} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending} data-testid="btn-save-cost-center">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
