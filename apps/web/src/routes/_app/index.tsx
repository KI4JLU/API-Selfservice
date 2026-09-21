import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { useSpend, type SpendSummary } from '@/lib/queries';
import { currentMonth, fmtDate, fmtDay, fmtMoney, fmtMonth, fmtNumber, fmtPercent } from '@/lib/format';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner, PageHeader } from '@/components/ui/page';
import { DataTable } from '@/components/ui/data-table';
import { BarList, SpendBarChart } from '@/components/charts';
import { BUDGET_WARN_THRESHOLD } from '@litelite/shared';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
});

type ByKey = SpendSummary['byKey'][number];
type ByProvider = SpendSummary['byProvider'][number];

function DashboardPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth());
  const { data, isLoading } = useSpend(month);

  const util = data?.utilization ?? null;
  const danger = !!data?.blocked || (util !== null && util >= 1);
  const warn = util !== null && util >= BUDGET_WARN_THRESHOLD;

  const keyColumns: ColumnDef<ByKey>[] = [
    { header: t('requests.key'), accessorKey: 'keyName', cell: ({ row }) => <span className="font-medium">{row.original.keyName}</span> },
    { header: t('dashboard.totalRequests'), accessorKey: 'requests', cell: ({ row }) => fmtNumber(row.original.requests), meta: { className: 'text-right tabular-nums' } },
    { header: t('common.spend'), accessorKey: 'spend', cell: ({ row }) => fmtMoney(row.original.spend, { precise: true }), meta: { className: 'text-right tabular-nums' } },
  ];
  const providerColumns: ColumnDef<ByProvider>[] = [
    { header: t('providers.provider'), accessorKey: 'provider', cell: ({ row }) => <span className="font-medium">{row.original.provider}</span> },
    { header: t('dashboard.totalRequests'), accessorKey: 'requests', cell: ({ row }) => fmtNumber(row.original.requests), meta: { className: 'text-right tabular-nums' } },
    { header: t('dashboard.totalTokens'), accessorKey: 'tokens', cell: ({ row }) => fmtNumber(row.original.tokens), meta: { className: 'text-right tabular-nums' } },
    { header: t('common.spend'), accessorKey: 'spend', cell: ({ row }) => fmtMoney(row.original.spend, { precise: true }), meta: { className: 'text-right tabular-nums' } },
  ];

  const periodLabel = data ? `${fmtDate(data.periodStart)} – ${fmtDate(new Date(new Date(data.periodEnd).getTime() - 1).toISOString())}` : '';

  return (
    <div className="flex flex-col gap-4" data-testid="page-dashboard">
      <PageHeader
        title={t('dashboard.title')}
        className="mb-0"
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="month">{t('common.month')}</Label>
            <Input id="month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" data-testid="input-month" />
          </div>
        }
      />

      {data?.blocked ? (
        <Banner variant="danger" testId="banner-blocked">
          {t('dashboard.blocked')}
        </Banner>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="budget-cards">
        <StatCard
          label={t('dashboard.budgetAssigned')}
          loading={isLoading}
          value={data?.budget ? fmtMoney(data.budget.amount) : t('dashboard.noBudget')}
          valueClassName={data?.budget ? undefined : 'text-muted-foreground text-lg'}
          footer={
            data?.budget
              ? `${t(`period.${data.budget.period}`)}${data.budget.period === 'project' && data.budget.periodStart ? ` · ${fmtDate(data.budget.periodStart)} – ${fmtDate(data.budget.periodEnd)}` : ''}`
              : undefined
          }
          testId="stat-budget"
        />
        <StatCard label={t('dashboard.spendCurrent')} loading={isLoading} value={fmtMoney(data?.spend)} footer={periodLabel} testId="stat-spend" />
        <StatCard label={t('dashboard.remaining')} loading={isLoading} value={data?.remaining === null || data?.remaining === undefined ? t('common.unlimited') : fmtMoney(data.remaining)} />
        <StatCard
          label={t('common.utilization')}
          loading={isLoading}
          value={util === null ? '–' : fmtPercent(util)}
          valueClassName={danger ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-500' : undefined}
          footer={<Progress value={util === null ? 0 : Math.min(100, util * 100)} indicatorClassName={danger ? 'bg-destructive' : warn ? 'bg-amber-500' : undefined} className="w-full" />}
        />
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" data-testid="metrics-cards">
        <StatCard label={t('dashboard.totalRequests')} loading={isLoading} value={fmtNumber(data?.metrics.totalRequests)} />
        <StatCard label={t('dashboard.successfulRequests')} loading={isLoading} value={fmtNumber(data?.metrics.successfulRequests)} />
        <StatCard label={t('dashboard.failedRequests')} loading={isLoading} value={fmtNumber(data?.metrics.failedRequests)} valueClassName={data?.metrics.failedRequests ? 'text-destructive' : undefined} />
        <StatCard label={t('dashboard.avgCost')} loading={isLoading} value={fmtMoney(data?.metrics.avgCostPerRequest, { precise: true })} />
        <StatCard
          label={t('dashboard.totalTokens')}
          loading={isLoading}
          value={fmtNumber(data?.metrics.totalTokens)}
          footer={`${t('dashboard.tokensIn')} ${fmtNumber(data?.metrics.tokensIn)} · ${t('dashboard.tokensOut')} ${fmtNumber(data?.metrics.tokensOut)}`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.dailySpend')}</CardTitle>
            <CardDescription>{periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px] w-full" /> : data && data.daily.length ? <SpendBarChart data={data.daily} xKey="date" yKey="spend" xFormatter={fmtDay} name={t('common.spend')} /> : <Empty />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.history')}</CardTitle>
            <CardDescription>{t('dashboard.historyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px] w-full" /> : data ? <SpendBarChart data={data.history} xKey="month" yKey="spend" xFormatter={fmtMonth} name={t('common.spend')} color="var(--chart-2)" /> : <Empty />}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.topKeys')}</CardTitle>
            <CardDescription>{t('dashboard.topKeysDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable columns={keyColumns} data={data?.byKey ?? []} isLoading={isLoading} testId="table-top-keys" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.topModels')}</CardTitle>
            <CardDescription>{t('dashboard.topModelsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-24 w-full" /> : data && data.byModel.length ? <BarList items={data.byModel.map((m) => ({ label: m.model, value: m.spend, sub: `${fmtNumber(m.requests)} req` }))} /> : <Empty className="h-24" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.byProvider')}</CardTitle>
            <CardDescription>{t('dashboard.byProviderDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable columns={providerColumns} data={data?.byProvider ?? []} isLoading={isLoading} testId="table-by-provider" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatCard({ label, value, footer, loading, valueClassName, testId }: { label: string; value: React.ReactNode; footer?: React.ReactNode; loading?: boolean; valueClassName?: string; testId?: string }) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn('text-2xl font-bold tabular-nums', valueClassName)} data-testid={testId}>
          {loading ? <Skeleton className="h-7 w-24" /> : value}
        </CardTitle>
      </CardHeader>
      {footer ? <CardFooter className="text-muted-foreground px-5 text-xs">{loading ? <Skeleton className="h-3 w-32" /> : footer}</CardFooter> : null}
    </Card>
  );
}

function Empty({ className = 'h-[220px]' }: { className?: string }) {
  const { t } = useTranslation();
  return <div className={cn('text-muted-foreground flex items-center justify-center text-sm', className)}>{t('common.empty')}</div>;
}
