import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useReportDetail } from '@/lib/queries';
import { fmtCostCenter, fmtMoney, fmtNumber, fmtPercent } from '@/lib/format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BUDGET_WARN_THRESHOLD } from '@api-selfservice/shared';

export function ReportDetailBody({ id, from, to }: { id: string; from?: string; to?: string }) {
  const { t } = useTranslation();
  const detail = useReportDetail(id, { from, to });
  if (detail.isLoading || !detail.data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const s = detail.data.summary;
  const util = s.utilization;
  return (
    <div className="flex flex-col gap-4" data-testid="report-detail">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('common.budget')} value={s.budget === null ? t('common.unlimited') : fmtMoney(s.budget)} />
        <Stat label={t('common.spend')} value={fmtMoney(s.spend, { precise: true })} />
        <Stat label={t('common.remaining')} value={s.remaining === null ? '–' : fmtMoney(s.remaining)} />
        <Stat label={t('common.utilization')} value={util === null ? '–' : fmtPercent(util)}>
          <Progress
            value={util === null ? 0 : Math.min(100, util * 100)}
            indicatorClassName={util !== null && util >= 1 ? 'bg-destructive' : util !== null && util >= BUDGET_WARN_THRESHOLD ? 'bg-warning' : undefined}
            className="mt-2"
          />
        </Stat>
      </div>
      <div className="text-muted-foreground text-sm">
        {t('reports.userCount')}: {s.userCount} · {t('reports.keyCount')}: {s.keyCount} · {t('reports.requests')}: {fmtNumber(s.requests)}
      </div>
      <div className="rounded-md border">
        <Table data-testid="table-report-users">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>
                {t('costCenters.users')} / {t('costCenters.keys')}
              </TableHead>
              <TableHead className="text-right">{t('reports.requests')}</TableHead>
              <TableHead className="text-right">{t('common.spend')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.data.users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  {t('common.empty')}
                </TableCell>
              </TableRow>
            ) : (
              detail.data.users.map((u) => (
                <Fragment key={u.user.id}>
                  <TableRow className="bg-muted/50">
                    <TableCell>
                      <div className="font-medium">{u.user.name}</div>
                      <div className="text-muted-foreground text-xs">{u.user.email}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(u.requests)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtMoney(u.spend, { precise: true })}</TableCell>
                  </TableRow>
                  {u.keys.map((k) => (
                    <TableRow key={`${u.user.id}-${k.keyId ?? k.keyName}`}>
                      <TableCell className="pl-8">{k.keyName}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{fmtNumber(k.requests)}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{fmtMoney(k.spend, { precise: true })}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {children}
    </div>
  );
}

export function CostCenterReportSheet({ costCenter, onClose, from, to }: { costCenter: { id: string; number: string; name: string } | null; onClose: () => void; from?: string; to?: string }) {
  const { t } = useTranslation();
  return (
    <Sheet open={!!costCenter} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl" data-testid="sheet-report-detail">
        <SheetHeader>
          <SheetTitle>{t('reports.title')}</SheetTitle>
          <SheetDescription>{costCenter ? `${fmtCostCenter(costCenter.number)} · ${costCenter.name}` : ''}</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-4">{costCenter ? <ReportDetailBody id={costCenter.id} from={from} to={to} /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}
