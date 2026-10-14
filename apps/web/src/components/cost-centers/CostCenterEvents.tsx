import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CircleX, Download, Info, TriangleAlert } from 'lucide-react';
import { COST_CENTER_EVENT_CATEGORIES, type AuditSeverity, type CostCenterEventCategory } from '@api-selfservice/shared';
import { api } from '@/lib/api';
import { useCostCenterEvents, type CostCenterEvent } from '@/lib/queries';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { CostCenterEventsSchema } from '@api-selfservice/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const PAGE = 50;
type Period = '7' | '30' | '90' | 'all';

const severityIcon: Record<AuditSeverity, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  info: { icon: Info, className: 'text-muted-foreground' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleX, className: 'text-destructive' },
};

/** One line under the event title from the fields the portal writes into the payload. */
function eventDetail(e: CostCenterEvent, t: TFunction): string | null {
  const p = e.payload ?? {};
  const parts: string[] = [];
  if (e.entity === 'api_key' && e.entityLabel) parts.push(t('ccDetail.eventKey', { name: e.entityLabel }));
  if (typeof p.maxBudget === 'number' || p.maxBudget === null) parts.push(t('ccDetail.eventBudget', { value: p.maxBudget === null ? t('common.unlimited') : fmtMoney(p.maxBudget as number) }));
  if (typeof p.memberBudget === 'number' || p.memberBudget === null)
    parts.push(t('ccDetail.eventMemberBudget', { value: p.memberBudget === null ? t('common.unlimited') : fmtMoney(p.memberBudget as number) }));
  if (typeof p.threshold === 'number') parts.push(t('ccDetail.eventThreshold', { pct: Math.round((p.threshold as number) * 100) }));
  if (typeof p.role === 'string') parts.push(t('ccDetail.eventRole', { role: t(`members.roles.${p.role}`, { defaultValue: p.role }) }));
  if (typeof p.reason === 'string') parts.push(t('ccDetail.eventReason', { reason: p.reason }));
  return parts.length ? parts.join(' · ') : null;
}

/** #13: events of the cost center with category chips, warnings filter, search, period and CSV export. */
export function CostCenterEvents({ id, number }: { id: string; number: string }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<CostCenterEventCategory | null>(null);
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('30');
  const [pages, setPages] = useState(1);
  const from = period === 'all' ? undefined : new Date(Date.now() - Number(period) * 86_400_000).toISOString();
  const params = { category: category ?? undefined, warningsOnly: warningsOnly ? 'true' : undefined, q: q.trim() || undefined, from };
  const events = useCostCenterEvents(id, { ...params, page: 1, pageSize: PAGE * pages });
  const data = events.data;
  const reset = () => setPages(1);

  const exportCsv = async () => {
    const all = await api.get(`/cost-centers/${id}/events`, CostCenterEventsSchema, { ...params, page: 1, pageSize: 500 });
    const rows = all.items.map((e) => [
      fmtDateTime(e.createdAt),
      t(`severity.${e.severity}`),
      t(`ccDetail.categories.${e.category}`),
      t(`auditActions.${e.action}`, { defaultValue: e.action }),
      eventDetail(e, t),
      e.actor?.name ?? t('events.system'),
      e.subject?.name ?? '',
    ]);
    downloadCsv(
      `ereignisse-${number}.csv`,
      toCsv([[t('events.time'), t('events.severity'), t('ccDetail.category'), t('events.action'), t('ccDetail.details'), t('ccDetail.by'), t('ccDetail.concerns')], ...rows]),
    );
  };

  const chip = (key: CostCenterEventCategory | null, label: string, count?: number) => (
    <button
      key={key ?? 'all'}
      type="button"
      onClick={() => {
        setCategory(key);
        reset();
      }}
      className={cn('rounded-full border px-3 py-1 text-xs', category === key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}
      aria-pressed={category === key}
      data-testid={`chip-event-${key ?? 'all'}`}
    >
      {label} {count !== undefined ? <span className="opacity-70">{count}</span> : null}
    </button>
  );

  return (
    <section className="flex flex-col gap-3" data-testid="tab-events">
      <div className="flex flex-wrap items-center gap-2">
        {chip(null, t('common.all'), data?.counts.all)}
        {COST_CENTER_EVENT_CATEGORIES.map((c) => chip(c, t(`ccDetail.categories.${c}`), data?.counts[c]))}
        <span className="bg-border mx-1 h-5 w-px" />
        <button
          type="button"
          onClick={() => {
            setWarningsOnly((w) => !w);
            reset();
          }}
          className={cn('rounded-full border px-3 py-1 text-xs', warningsOnly ? 'bg-warning text-on-warning border-warning' : 'border-warning/60 text-warning hover:bg-muted')}
          aria-pressed={warningsOnly}
          data-testid="chip-event-warnings"
        >
          {t('ccDetail.warningsOnly')} <span className="opacity-70">{data?.counts.warnings}</span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
          placeholder={t('ccDetail.searchEvents')}
          className="h-9 w-64"
          data-testid="input-event-search"
        />
        <SimpleSelect
          value={period}
          onValueChange={(v) => {
            setPeriod(v as Period);
            reset();
          }}
          options={(['7', '30', '90', 'all'] as const).map((p) => ({ value: p, label: t(`ccDetail.periods.${p}`) }))}
          className="w-40"
          testId="input-event-period"
        />
        <Button variant="outline" size="sm" onClick={exportCsv} data-testid="btn-export-events">
          <Download />
          {t('ccDetail.exportCsv')}
        </Button>
      </div>
      <div className="rounded-md border">
        <Table data-testid="table-cost-center-events">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t('events.time')}</TableHead>
              <TableHead>{t('events.severity')}</TableHead>
              <TableHead>{t('ccDetail.category')}</TableHead>
              <TableHead>{t('ccDetail.event')}</TableHead>
              <TableHead>{t('ccDetail.by')}</TableHead>
              <TableHead>{t('ccDetail.concerns')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground h-20 text-center">
                  {t('ccDetail.noEvents')}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((e) => {
                const sev = severityIcon[e.severity];
                const Icon = sev.icon;
                const detail = eventDetail(e, t);
                return (
                  <TableRow key={e.id} data-testid="row-event" data-action={e.action}>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums">{fmtDateTime(e.createdAt)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-xs">
                        <Icon className={cn('size-3.5', sev.className)} />
                        {t(`severity.${e.severity}`)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.category === 'limits' ? 'destructive' : 'outline'}>{t(`ccDetail.categories.${e.category}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{t(`auditActions.${e.action}`, { defaultValue: e.action })}</div>
                      {detail ? <div className="text-muted-foreground text-xs">{detail}</div> : null}
                    </TableCell>
                    <TableCell className="text-sm">{e.actor?.name ?? <span className="text-muted-foreground">{t('events.system')}</span>}</TableCell>
                    <TableCell className="text-sm">{e.subject?.name ?? <span className="text-muted-foreground">–</span>}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {data ? (
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span data-testid="events-shown">{t('ccDetail.eventsShown', { shown: data.items.length, total: data.total })}</span>
          {data.items.length < data.total ? (
            <Button variant="outline" size="sm" onClick={() => setPages((p) => p + 1)} data-testid="btn-events-more">
              {t('ccDetail.loadOlder')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
