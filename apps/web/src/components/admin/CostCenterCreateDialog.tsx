import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { BudgetPeriod } from '@api-selfservice/shared';
import { useCreateCostCenter } from '@/lib/queries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { BudgetFields, periodDates } from '@/components/cost-centers/CostCenterEditDialog';
import { OwnerPicker, type Owner } from '@/components/admin/OwnerPicker';

function formatNumberInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

export function CostCenterCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const create = useCreateCostCenter();
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState<Owner | null>(null);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (open) {
      setNumber('');
      setName('');
      setOwner(null);
      setAmount('');
      setPeriod('monthly');
      setStart('');
      setEnd('');
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const digits = number.replace(/\s/g, '');
    if (digits.length !== 8) {
      toast.error(t('profile.costCenterInvalid'));
      return;
    }
    if (!owner) {
      toast.error(t('costCenters.ownerRequired'));
      return;
    }
    const maxBudget = amount.trim() === '' ? null : Number(amount);
    const res = await create
      .mutateAsync({
        number: digits,
        name: name.trim(),
        ownerUserId: owner.userId,
        maxBudget,
        budgetPeriod: maxBudget === null ? null : period,
        ...(maxBudget === null ? { periodStart: null, periodEnd: null } : periodDates(period, start, end)),
      })
      .catch(() => null);
    if (res) {
      toast.success(t('costCenters.created'));
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-cost-center">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('costCenters.create')}</DialogTitle>
            <DialogDescription>{t('costCenters.createHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label={t('costCenters.number')} htmlFor="ncc-number" required>
              <Input
                id="ncc-number"
                required
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(formatNumberInput(e.target.value))}
                placeholder="1234 5678"
                className="font-mono"
                data-testid="input-cc-number"
              />
            </Field>
            <Field label={t('costCenters.name')} htmlFor="ncc-name" required>
              <Input id="ncc-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-cc-name" />
            </Field>
          </div>
          <OwnerPicker value={owner} onChange={setOwner} idPrefix="ncc" />
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
            idPrefix="ncc"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} data-testid="btn-submit-create-cost-center">
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
