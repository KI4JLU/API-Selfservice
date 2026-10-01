import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
          <Input id={`${idPrefix}-amount`} type="number" min={0} step="0.01" required={required} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={required ? '' : t('common.unlimited')} data-testid="input-budget-amount" />
        </Field>
        <Field label={t('common.period')} htmlFor={`${idPrefix}-period`}>
          <SimpleSelect id={`${idPrefix}-period`} value={period} onValueChange={(v) => setPeriod(v as BudgetPeriod)} options={BUDGET_PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))} testId="input-budget-period" />
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

/** F-KST-15: models released for a cost center; none selected = all models. */
function ModelRelease({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const providers = useAdminProviders();
  // Unavailable models stay visible while selected, so they can be removed.
  const items = (providers.data ?? []).filter((p) => p.available || value.includes(p.modelName));
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-sm font-medium">
        {t('costCenters.models')}
        <span className="text-xs font-normal text-muted-foreground">{value.length === 0 ? t('costCenters.modelsAll') : t('keys.modelsSelected', { count: value.length })}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('costCenters.modelsHint')}</p>
      <div className="max-h-48 overflow-y-auto rounded-md border" data-testid="list-cc-models">
        {items.map((p) => (
          <label key={p.id} className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-3 py-1.5 last:border-0" data-testid={`cc-model-${p.modelName}`}>
            <Checkbox checked={value.includes(p.modelName)} onCheckedChange={(v) => onChange(v === true ? [...value, p.modelName] : value.filter((x) => x !== p.modelName))} />
            <span className="font-mono text-xs">{p.modelName}</span>
            <TierBadge tier={p.tier} />
            {p.provider ? <span className="text-xs text-muted-foreground">{p.provider}</span> : null}
          </label>
        ))}
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
      <DialogContent data-testid="dialog-edit-cost-center">
        <form onSubmit={submit} className="grid gap-4">
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
          <BudgetFields amount={amount} setAmount={setAmount} period={period} setPeriod={setPeriod} start={start} setStart={setStart} end={end} setEnd={setEnd} amountLabel={t('costCenters.maxBudget')} idPrefix="cc" />
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
