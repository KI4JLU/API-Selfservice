import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BUDGET_PERIODS, type BudgetPeriod } from '@api-selfservice/shared';
import { useUpdateCostCenter, type CostCenter } from '@/lib/queries';
import { fmtCostCenter, toDateInput } from '@/lib/format';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';

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
        <Field label={amountLabel} htmlFor={`${idPrefix}-amount`} hint={required ? undefined : t('costCenters.maxBudgetHint')}>
          <Input id={`${idPrefix}-amount`} type="number" min={0} step="0.01" required={required} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={required ? '' : t('common.unlimited')} data-testid="input-budget-amount" />
        </Field>
        <Field label={t('common.period')} htmlFor={`${idPrefix}-period`}>
          <SimpleSelect id={`${idPrefix}-period`} value={period} onValueChange={(v) => setPeriod(v as BudgetPeriod)} options={BUDGET_PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))} testId="input-budget-period" />
        </Field>
      </div>
      {period === 'project' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.from')} htmlFor={`${idPrefix}-start`}>
            <Input id={`${idPrefix}-start`} type="date" required value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-budget-start" />
          </Field>
          <Field label={t('common.to')} htmlFor={`${idPrefix}-end`}>
            <Input id={`${idPrefix}-end`} type="date" required value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-budget-end" />
          </Field>
        </div>
      ) : null}
    </>
  );
}

export function periodDates(period: BudgetPeriod, start: string, end: string) {
  if (period !== 'project') return { periodStart: null, periodEnd: null };
  return {
    periodStart: start ? new Date(`${start}T00:00:00.000Z`).toISOString() : null,
    periodEnd: end ? new Date(`${end}T00:00:00.000Z`).toISOString() : null,
  };
}

/** Edit a cost center. `full` (admin) also edits name and owner; otherwise only the max budget. */
export function CostCenterEditDialog({ costCenter, onClose, full }: { costCenter: CostCenter | null; onClose: () => void; full?: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateCostCenter();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!costCenter) return;
    setName(costCenter.name);
    setOwnerName(costCenter.ownerName);
    setOwnerEmail(costCenter.ownerEmail);
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
      ...(full ? { name: name.trim(), ownerName: ownerName.trim(), ownerEmail: ownerEmail.trim() } : {}),
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
              <Field label={t('costCenters.name')} htmlFor="cc-name">
                <Input id="cc-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-cc-name" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('costCenters.owner')} htmlFor="cc-owner">
                  <Input id="cc-owner" required maxLength={200} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} data-testid="input-cc-owner-name" />
                </Field>
                <Field label={t('costCenters.ownerEmail')} htmlFor="cc-owner-email">
                  <Input id="cc-owner-email" type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} data-testid="input-cc-owner-email" />
                </Field>
              </div>
            </>
          ) : null}
          <BudgetFields amount={amount} setAmount={setAmount} period={period} setPeriod={setPeriod} start={start} setStart={setStart} end={end} setEnd={setEnd} amountLabel={t('costCenters.maxBudget')} idPrefix="cc" />
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
