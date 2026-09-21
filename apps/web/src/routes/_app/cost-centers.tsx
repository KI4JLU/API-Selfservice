import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BarChart3, Pencil, TriangleAlert } from 'lucide-react';
import { requireCostCenterAdmin } from '@/lib/guards';
import { useManagedCostCenters, type CostCenter } from '@/lib/queries';
import { fmtCostCenter, fmtDate, fmtMoney, fmtPercent } from '@/lib/format';
import { PageHeader } from '@/components/ui/page';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { CostCenterEditDialog } from '@/components/cost-centers/CostCenterEditDialog';
import { CostCenterReportSheet } from '@/components/cost-centers/CostCenterReportSheet';
import { BUDGET_WARN_THRESHOLD } from '@litelite/shared';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/cost-centers')({
  beforeLoad: ({ context }) => requireCostCenterAdmin(context.me),
  component: MyCostCentersPage,
});

function MyCostCentersPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useManagedCostCenters();
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [report, setReport] = useState<CostCenter | null>(null);

  const util = (c: CostCenter) => (c.maxBudget ? c.spendCurrentPeriod / c.maxBudget : null);

  return (
    <div data-testid="page-cost-centers">
      <PageHeader title={t('costCenters.myTitle')} subtitle={t('costCenters.mySubtitle')} />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      ) : (data?.items ?? []).length === 0 ? (
        <div className="text-muted-foreground rounded-md border p-8 text-center text-sm">{t('common.empty')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="list-managed-cost-centers">
          {(data?.items ?? []).map((c) => {
            const u = util(c);
            const danger = c.blocked || (u !== null && u >= 1);
            const warn = u !== null && u >= BUDGET_WARN_THRESHOLD;
            return (
              <Card key={c.id} data-testid="card-cost-center">
                <CardHeader>
                  <CardDescription className="font-mono">{fmtCostCenter(c.number)}</CardDescription>
                  <CardTitle className="truncate">{c.name}</CardTitle>
                  <CardDescription className="truncate">
                    {c.ownerName} · {c.ownerEmail}
                  </CardDescription>
                  <CardAction className="flex flex-col items-end gap-1">
                    {c.isDefault ? <Badge variant="secondary">{t('costCenters.default')}</Badge> : null}
                    {c.blocked ? (
                      <Badge variant="destructive">
                        <TriangleAlert />
                        {t('status.blocked')}
                      </Badge>
                    ) : null}
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">{t('costCenters.maxBudget')}</div>
                      <div className="font-medium tabular-nums">{c.maxBudget === null ? t('common.unlimited') : fmtMoney(c.maxBudget)}</div>
                      {c.budgetPeriod ? (
                        <div className="text-muted-foreground text-xs">
                          {t(`period.${c.budgetPeriod}`)}
                          {c.budgetPeriod === 'project' ? ` ${fmtDate(c.periodStart)} – ${fmtDate(c.periodEnd)}` : ''}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">{t('common.spend')}</div>
                      <div className="font-medium tabular-nums">{fmtMoney(c.spendCurrentPeriod, { precise: true })}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">{t('common.utilization')}</div>
                      <div className={cn('font-medium tabular-nums', danger ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-500' : '')}>{u === null ? '–' : fmtPercent(u)}</div>
                    </div>
                  </div>
                  <Progress value={u === null ? 0 : Math.min(100, u * 100)} indicatorClassName={danger ? 'bg-destructive' : warn ? 'bg-amber-500' : undefined} />
                  {c.blocked ? <div className="text-destructive text-xs">{t('costCenters.blocked')}</div> : null}
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setReport(c)} data-testid="btn-cost-center-report">
                    <BarChart3 />
                    {t('reports.detail')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(c)} disabled={c.isDefault} data-testid="btn-edit-cost-center">
                    <Pencil />
                    {t('costCenters.editBudget')}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
      <CostCenterEditDialog costCenter={editing} onClose={() => setEditing(null)} />
      <CostCenterReportSheet costCenter={report} onClose={() => setReport(null)} />
    </div>
  );
}
