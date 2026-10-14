import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Download, Pencil } from 'lucide-react';
import { BUDGET_WARN_THRESHOLD } from '@api-selfservice/shared';
import { requireCostCenterAdmin } from '@/lib/guards';
import { useCostCenter, useCostCenterMembers, useMe, usePendingJoinRequests, useReportDetail } from '@/lib/queries';
import { fmtCostCenter, fmtMoney, fmtNumber } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CostCenterEditDialog } from '@/components/cost-centers/CostCenterEditDialog';
import { AddMember, JoinRequests, MemberList } from '@/components/cost-centers/CostCenterMembersSheet';
import { CostCenterUsage, usageRange, type UsageRange } from '@/components/cost-centers/CostCenterUsage';
import { CostCenterEvents } from '@/components/cost-centers/CostCenterEvents';

export const Route = createFileRoute('/_app/cost-centers_/$id')({
  beforeLoad: ({ context }) => requireCostCenterAdmin(context.me),
  component: CostCenterDetailPage,
});

function Kpi({ label, value, hint, children, testId }: { label: string; value: string; hint?: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-md border p-3" data-testid={testId}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
      {children}
    </div>
  );
}

/** #13: one page per cost center for its cost center admins: key figures, members, spend and events. */
function CostCenterDetailPage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { data: me } = useMe();
  const cc = useCostCenter(id);
  const members = useCostCenterMembers(id);
  const requests = usePendingJoinRequests(id);
  const [range, setRange] = useState<UsageRange>('current');
  const report = useReportDetail(id, usageRange(range));
  const current = useReportDetail(id, {});
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('members');

  if (cc.isLoading || !cc.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const c = cc.data;
  const s = current.data?.summary;
  const open = requests.data?.length ?? 0;
  const canManageAdmins = me?.role === 'admin' || (!!c.ownerUserId && me?.id === c.ownerUserId);
  const util = c.maxBudget ? c.spendCurrentPeriod / c.maxBudget : null;

  const exportReport = () => {
    const d = report.data;
    if (!d) return;
    const rows: (string | number | null)[][] = [[t('ccDetail.groups.user'), t('common.email'), t('ccDetail.groups.key'), t('reports.requests'), t('common.spend')]];
    for (const u of d.users) for (const k of u.keys) rows.push([u.user.name, u.user.email, k.keyName, k.requests, k.spend]);
    downloadCsv(`report-${c.number}.csv`, toCsv(rows));
  };

  return (
    <div data-testid="page-cost-center-detail">
      <nav className="text-muted-foreground mb-2 text-xs">
        <Link to="/cost-centers" className="hover:underline">
          {t('costCenters.myTitle')}
        </Link>{' '}
        / {fmtCostCenter(c.number)} · {c.name}
      </nav>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="text-muted-foreground font-mono text-xs">{fmtCostCenter(c.number)}</div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="cost-center-title">
            {c.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('ccDetail.owner')}: {c.ownerName} · {c.ownerEmail}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportReport} disabled={!report.data} data-testid="btn-export-report">
            <Download />
            {t('ccDetail.exportReport')}
          </Button>
          <Button onClick={() => setEditing(true)} disabled={c.isDefault} data-testid="btn-edit-cost-center">
            <Pencil />
            {t('costCenters.editBudget')}
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="cost-center-kpis">
        <Kpi
          label={t('costCenters.maxBudget')}
          value={c.maxBudget === null ? t('common.unlimited') : fmtMoney(c.maxBudget)}
          hint={c.maxBudget === null ? t('ccDetail.noLimit') : t(`period.${c.budgetPeriod ?? 'monthly'}`)}
        />
        <Kpi label={t('common.spend')} value={fmtMoney(c.spendCurrentPeriod, { precise: true })} hint={t('ccDetail.currentPeriod')}>
          {util !== null ? (
            <Progress value={Math.min(100, util * 100)} className="mt-2" indicatorClassName={util >= 1 ? 'bg-destructive' : util >= BUDGET_WARN_THRESHOLD ? 'bg-warning' : undefined} />
          ) : null}
        </Kpi>
        <Kpi label={t('common.remaining')} value={c.maxBudget === null ? '–' : fmtMoney(Math.max(0, c.maxBudget - c.spendCurrentPeriod))} />
        <Kpi label={t('members.title')} value={fmtNumber(members.data?.length ?? 0)} hint={t('ccDetail.openRequests', { count: open })} testId="kpi-members" />
        <Kpi label={t('reports.requests')} value={fmtNumber(s?.requests ?? 0)} hint={t('ccDetail.allKeys')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-trigger-members">
            {t('members.title')} {members.data ? <span className="text-muted-foreground">{members.data.length}</span> : null}
            {open ? (
              <Badge variant="secondary" className="bg-warning text-on-warning ml-1">
                {t('ccDetail.openBadge', { count: open })}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="usage" data-testid="tab-trigger-usage">
            {t('ccDetail.usageTab')}
          </TabsTrigger>
          <TabsTrigger value="events" data-testid="tab-trigger-events">
            {t('ccDetail.eventsTab')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4 flex flex-col gap-6">
          {c.isDefault ? (
            <p className="text-muted-foreground text-sm">{t('ccDetail.defaultMembers')}</p>
          ) : (
            <>
              <JoinRequests id={c.id} />
              <AddMember id={c.id} canManageAdmins={canManageAdmins} />
              <MemberList id={c.id} ownerUserId={c.ownerUserId} canManageAdmins={canManageAdmins} />
            </>
          )}
        </TabsContent>
        <TabsContent value="usage" className="mt-4">
          <CostCenterUsage id={c.id} range={range} setRange={setRange} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <CostCenterEvents id={c.id} number={c.number} />
        </TabsContent>
      </Tabs>

      <CostCenterEditDialog costCenter={editing ? c : null} onClose={() => setEditing(false)} />
    </div>
  );
}
