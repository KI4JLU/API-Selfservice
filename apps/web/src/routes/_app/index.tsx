import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus, UserPlus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useKeys, useMe, useMyJoinRequests, useSpend, type CreatedApiKey, type Me, type SpendSummary } from '@/lib/queries';
import { currentMonth, fmtDate, fmtDay, fmtMoney, fmtMonth, fmtNumber, fmtPercent } from '@/lib/format';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner, PageHeader } from '@/components/ui/page';
import { DataTable } from '@/components/ui/data-table';
import { BarList, SpendBarChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreateKeyDialog } from '@/components/keys/CreateKeyDialog';
import { KeySecretDialog } from '@/components/keys/KeySecretDialog';
import { BUDGET_WARN_THRESHOLD, KEY_EXPIRY_WARN_DAYS } from '@api-selfservice/shared';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
});

type ByKey = SpendSummary['byKey'][number];
type ByProvider = SpendSummary['byProvider'][number];

function DashboardPage() {
  const { t } = useTranslation();
  // Live query, not the route context: memberships changed elsewhere must show up without a reload.
  const me = useMe().data ?? Route.useRouteContext().me;
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
      <PageHeader title={t('dashboard.title')} className="mb-0" />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="dashboard-overview">
        <KeysOverview me={me} />
        <CostCentersOverview me={me} />
      </section>

      <PageHeader
        title={<span className="text-xl">{t('dashboard.budgetTitle')}</span>}
        className="mt-2 mb-0"
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
          valueClassName={danger ? 'text-destructive' : warn ? 'text-warning' : undefined}
          footer={<Progress value={util === null ? 0 : Math.min(100, util * 100)} indicatorClassName={danger ? 'bg-destructive' : warn ? 'bg-warning' : undefined} className="w-full" />}
        />
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" data-testid="metrics-cards">
        <StatCard label={t('dashboard.totalRequests')} loading={isLoading} value={fmtNumber(data?.metrics.totalRequests)} />
        <StatCard label={t('dashboard.successfulRequests')} loading={isLoading} value={fmtNumber(data?.metrics.successfulRequests)} />
        <StatCard
          label={t('dashboard.failedRequests')}
          loading={isLoading}
          value={fmtNumber(data?.metrics.failedRequests)}
          valueClassName={data?.metrics.failedRequests ? 'text-destructive' : undefined}
        />
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
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : data && data.daily.length ? (
              <SpendBarChart data={data.daily} xKey="date" yKey="spend" xFormatter={fmtDay} name={t('common.spend')} />
            ) : (
              <Empty />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.history')}</CardTitle>
            <CardDescription>{t('dashboard.historyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : data ? (
              <SpendBarChart data={data.history} xKey="month" yKey="spend" xFormatter={fmtMonth} name={t('common.spend')} color="var(--color-chart-2)" />
            ) : (
              <Empty />
            )}
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
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.byModel.length ? (
              <BarList items={data.byModel.map((m) => ({ label: m.model, value: m.spend, sub: `${fmtNumber(m.requests)} req` }))} />
            ) : (
              <Empty className="h-24" />
            )}
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

/** Hints for the own API keys; without a key the user can create the first one right here. */
function KeysOverview({ me }: { me: Me }) {
  const { t } = useTranslation();
  const keys = useKeys();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const live = (keys.data?.items ?? []).filter((k) => k.status !== 'deleted');
  const soon = Date.now() + KEY_EXPIRY_WARN_DAYS * 86_400_000;
  const blocked = live.filter((k) => k.status === 'blocked');
  const expired = live.filter((k) => k.status === 'expired');
  const expiring = live.filter((k) => k.status === 'active' && new Date(k.expiresAt).getTime() <= soon);
  const active = live.filter((k) => k.status === 'active');

  return (
    <Card data-testid="card-keys-overview">
      <CardHeader>
        <CardTitle>{t('nav.keys')}</CardTitle>
        <CardDescription>{keys.isLoading ? <Skeleton className="h-4 w-40" /> : t('dashboard.keysActive', { count: active.length, total: live.length })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {keys.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : live.length === 0 ? (
          <Banner testId="hint-no-key">{t('dashboard.noKeyHint')}</Banner>
        ) : (
          <>
            {blocked.length ? (
              <Banner variant="danger" testId="hint-keys-blocked">
                {t('dashboard.keysBlocked', { count: blocked.length, names: blocked.map((k) => k.name).join(', ') })}
              </Banner>
            ) : null}
            {expired.length ? (
              <Banner variant="warning" testId="hint-keys-expired">
                {t('dashboard.keysExpired', { count: expired.length, names: expired.map((k) => k.name).join(', ') })}
              </Banner>
            ) : null}
            {expiring.map((k) => (
              <Banner key={k.id} variant="warning" testId="hint-key-expiring">
                {t('dashboard.keyExpiring', { name: k.name, date: fmtDate(k.expiresAt) })}
              </Banner>
            ))}
            {!blocked.length && !expired.length && !expiring.length ? (
              <Banner variant="success" testId="hint-keys-ok">
                {t('dashboard.keysOk')}
              </Banner>
            ) : null}
          </>
        )}
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap justify-end gap-2">
        {live.length ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/keys" data-testid="link-keys">
              {t('dashboard.toKeys')}
              <ArrowRight />
            </Link>
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="btn-dashboard-create-key">
          <Plus />
          {t('keys.create')}
        </Button>
      </CardFooter>
      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} me={me} onCreated={setCreated} />
      <KeySecretDialog created={created} onClose={() => setCreated(null)} />
    </Card>
  );
}

/** Cost centers the user can create keys on (the default is always one of them) plus open join requests. */
function CostCentersOverview({ me }: { me: Me }) {
  const { t } = useTranslation();
  const requests = useMyJoinRequests();
  // The API lists the default first, followed by every membership.
  const memberships = me.memberCostCenters;
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending');

  return (
    <Card data-testid="card-cost-centers-overview">
      <CardHeader>
        <CardTitle>{t('nav.costCenterDirectory')}</CardTitle>
        <CardDescription>{t('dashboard.costCentersDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm" data-testid="list-my-cost-centers">
          {memberships.map((c, i) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2" data-testid="my-cost-center">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{c.name}</span>
                {i === 0 ? <Badge variant="secondary">{t('costCenters.default')}</Badge> : null}
              </span>
              <Badge variant="outline">{t(`members.roles.${c.role}`)}</Badge>
            </li>
          ))}
          {pending.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2" data-testid="my-join-request">
              <span className="text-muted-foreground truncate">{r.costCenter.name}</span>
              <Badge variant="outline">{t('joinRequests.status.pending')}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="mt-auto flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link to="/cost-center-directory" data-testid="link-join-cost-center">
            <UserPlus />
            {t('dashboard.joinCostCenter')}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function StatCard({
  label,
  value,
  footer,
  loading,
  valueClassName,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
  valueClassName?: string;
  testId?: string;
}) {
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
