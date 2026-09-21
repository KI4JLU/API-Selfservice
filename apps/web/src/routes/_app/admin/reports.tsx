import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { requireAdmin } from '@/lib/guards';
import { useReports, type ReportRow } from '@/lib/queries';
import { fmtCostCenter, fmtMoney, fmtNumber, fmtPercent } from '@/lib/format';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { WithTooltip } from '@/components/ui/tooltip';
import { ReportDetailBody } from '@/components/cost-centers/CostCenterReportSheet';
import { BUDGET_WARN_THRESHOLD } from '@litelite/shared';

export const Route = createFileRoute('/_app/admin/reports')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminReportsPage,
});

function monthRange() {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { from, to };
}

function AdminReportsPage() {
  const { t } = useTranslation();
  const [{ from, to }, setRange] = useState(monthRange());
  const reports = useReports({ from: from || undefined, to: to || undefined });
  const [expanded, setExpanded] = useState<string | null>(null);

  const totals = useMemo(() => {
    const rows = reports.data ?? [];
    return {
      spend: rows.reduce((s, r) => s + r.spend, 0),
      budget: rows.reduce((s, r) => s + (r.budget ?? 0), 0),
      requests: rows.reduce((s, r) => s + r.requests, 0),
    };
  }, [reports.data]);

  const columns = useMemo<ColumnDef<ReportRow>[]>(
    () => [
      {
        id: 'expand',
        header: '',
        cell: ({ row }) => (expanded === row.id ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />),
        size: 32,
      },
      {
        header: t('common.costCenter'),
        id: 'costCenter',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              <span className="font-mono tabular-nums">{fmtCostCenter(row.original.costCenter.number)}</span> · {row.original.costCenter.name}
            </div>
            <div className="text-muted-foreground text-xs">{row.original.costCenter.ownerName}</div>
          </div>
        ),
      },
      { header: t('common.budget'), accessorKey: 'budget', cell: ({ row }) => (row.original.budget === null ? <span className="text-muted-foreground">{t('common.unlimited')}</span> : fmtMoney(row.original.budget)), meta: { className: 'text-right tabular-nums' } },
      { header: t('common.spend'), accessorKey: 'spend', cell: ({ row }) => fmtMoney(row.original.spend, { precise: true }), meta: { className: 'text-right tabular-nums font-medium' } },
      { header: t('common.remaining'), accessorKey: 'remaining', cell: ({ row }) => (row.original.remaining === null ? '–' : fmtMoney(row.original.remaining)), meta: { className: 'text-right tabular-nums' } },
      {
        header: t('common.utilization'),
        accessorKey: 'utilization',
        cell: ({ row }) => {
          const u = row.original.utilization;
          return (
            <div className="min-w-32">
              <div className={`text-xs tabular-nums ${u !== null && u >= 1 ? 'text-destructive' : u !== null && u >= BUDGET_WARN_THRESHOLD ? 'text-amber-600 dark:text-amber-500' : ''}`}>{u === null ? '–' : fmtPercent(u)}</div>
              <Progress value={u === null ? 0 : Math.min(100, u * 100)} indicatorClassName={u !== null && u >= 1 ? 'bg-destructive' : u !== null && u >= BUDGET_WARN_THRESHOLD ? 'bg-amber-500' : undefined} className="mt-1.5" />
            </div>
          );
        },
      },
      { header: t('reports.userCount'), accessorKey: 'userCount', meta: { className: 'text-right tabular-nums' } },
      { header: t('reports.keyCount'), accessorKey: 'keyCount', meta: { className: 'text-right tabular-nums' } },
      { header: t('reports.requests'), accessorKey: 'requests', cell: ({ row }) => fmtNumber(row.original.requests), meta: { className: 'text-right tabular-nums' } },
    ],
    [t, expanded],
  );

  return (
    <div data-testid="page-admin-reports">
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={
          <WithTooltip text={t('reports.exportRelease2')}>
            <Button variant="outline" disabled data-testid="btn-export">
              <FileSpreadsheet />
              {t('reports.export')}
            </Button>
          </WithTooltip>
        }
      />
      <Toolbar>
        <Field label={t('common.from')} htmlFor="r-from">
          <Input id="r-from" type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-40" data-testid="input-report-from" />
        </Field>
        <Field label={t('common.to')} htmlFor="r-to">
          <Input id="r-to" type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-40" data-testid="input-report-to" />
        </Field>
        <div className="text-muted-foreground ml-auto flex gap-4 text-sm">
          <span>
            {t('common.budget')}: <span className="font-medium text-foreground tabular-nums">{fmtMoney(totals.budget)}</span>
          </span>
          <span>
            {t('common.spend')}: <span className="font-medium text-foreground tabular-nums">{fmtMoney(totals.spend, { precise: true })}</span>
          </span>
          <span>
            {t('reports.requests')}: <span className="font-medium text-foreground tabular-nums">{fmtNumber(totals.requests)}</span>
          </span>
        </div>
      </Toolbar>
      <DataTable
        columns={columns}
        data={reports.data ?? []}
        isLoading={reports.isLoading}
        testId="table-reports"
        getRowId={(r) => r.costCenter.id}
        onRowClick={(r) => setExpanded((e) => (e === r.costCenter.id ? null : r.costCenter.id))}
        expandedId={expanded}
        renderExpanded={(row) => <ReportDetailBody id={row.original.costCenter.id} from={from || undefined} to={to || undefined} />}
      />
    </div>
  );
}
