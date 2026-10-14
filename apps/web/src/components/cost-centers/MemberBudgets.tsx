import { useTranslation } from 'react-i18next';
import type { CostCenterMember } from '@/lib/queries';
import { fmtMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export type MemberPeriod = 'monthly' | 'once';

/** #15: budget per member without an individual one (LiteLLM team_member budget). */
export function MemberBudgetDefault({ amount, setAmount, period, setPeriod }: { amount: string; setAmount: (v: string) => void; period: MemberPeriod; setPeriod: (v: MemberPeriod) => void }) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-3" data-testid="section-member-budget">
      <div>
        <h3 className="text-sm font-semibold">{t('costCenters.memberBudgetTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('costCenters.memberBudgetHint')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('costCenters.memberBudget')} htmlFor="member-budget" hint={t('costCenters.maxBudgetHint')}>
          <Input
            id="member-budget"
            type="number"
            min={0.01}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('common.unlimited')}
            data-testid="input-member-budget"
          />
        </Field>
        <Field label={t('common.period')} htmlFor="member-budget-period">
          <SimpleSelect
            id="member-budget-period"
            value={period}
            onValueChange={(v) => setPeriod(v as MemberPeriod)}
            options={[
              { value: 'monthly', label: t('period.monthly') },
              { value: 'once', label: t('keys.budgetOnce') },
            ]}
            disabled={amount.trim() === ''}
            testId="input-member-budget-period"
          />
        </Field>
      </div>
    </section>
  );
}

/**
 * #15: individual budgets per member. `value[userId]` is the individual amount as typed, or null to use the member
 * budget. Spend is the current member budget period.
 */
export function MemberBudgetList({
  members,
  loading,
  defaultAmount,
  value,
  onChange,
}: {
  members: CostCenterMember[];
  loading: boolean;
  defaultAmount: string;
  value: Record<string, string | null>;
  onChange: (userId: string, v: string | null) => void;
}) {
  const { t } = useTranslation();
  const defaultValue = defaultAmount.trim() === '' ? null : Number(defaultAmount);
  return (
    <section className="grid gap-3" data-testid="section-member-budgets">
      <div>
        <h3 className="text-sm font-semibold">{t('costCenters.memberBudgetsTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('costCenters.memberBudgetsHint')}</p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t('costCenters.member')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('common.budget')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('common.spend')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-3">
                  <Skeleton className="h-5 w-full" />
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const own = value[m.userId] ?? null;
                const individual = own !== null;
                const limit = individual ? (own.trim() === '' ? null : Number(own)) : defaultValue;
                const pct = limit ? Math.min(100, (m.spendCurrentPeriod / limit) * 100) : 0;
                return (
                  <tr key={m.userId} className="border-t" data-testid={`member-budget-${m.userId}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{m.name ?? m.email ?? m.userId}</div>
                      {m.name && m.email ? <div className="text-xs text-muted-foreground">{m.email}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          className="h-8 w-24"
                          value={individual ? own : (defaultValue?.toString() ?? '')}
                          placeholder={t('common.unlimited')}
                          disabled={!individual}
                          onChange={(e) => onChange(m.userId, e.target.value)}
                          aria-label={t('costCenters.memberBudgetOf', { name: m.name ?? m.email ?? m.userId })}
                          data-testid="input-member-budget-individual"
                        />
                        <Badge variant={individual ? 'secondary' : 'outline'}>{individual ? t('costCenters.budgetIndividual') : t('costCenters.budgetDefault')}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {limit ? <Progress value={pct} className="w-16" indicatorClassName={pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : undefined} /> : null}
                        <span className={pct >= 80 ? 'font-medium text-warning tabular-nums' : 'tabular-nums'}>{fmtMoney(m.spendCurrentPeriod, { precise: true })}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => onChange(m.userId, individual ? null : (defaultValue?.toString() ?? ''))}
                        data-testid={individual ? 'btn-member-budget-reset' : 'btn-member-budget-individual'}
                      >
                        {individual ? t('costCenters.budgetResetToDefault') : t('costCenters.budgetSetIndividual')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">{t('costCenters.firstLimitWins')}</p>
    </section>
  );
}
