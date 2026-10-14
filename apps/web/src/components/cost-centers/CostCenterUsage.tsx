import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useReportDetail } from '@/lib/queries';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type UsageRange = 'current' | 'last' | '30d' | '90d' | 'year';
export type UsageGroup = 'user' | 'key' | 'model';

/** Date range (YYYY-MM-DD, inclusive) of a range choice; `current` leaves it to the cost center period. */
export function usageRange(range: UsageRange, now = new Date()): { from?: string; to?: string } {
  const d = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  switch (range) {
    case 'last':
      return { from: d(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: d(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case '30d':
      return { from: d(ago(29)), to: d(now) };
    case '90d':
      return { from: d(ago(89)), to: d(now) };
    case 'year':
      return { from: d(new Date(now.getFullYear(), 0, 1)), to: d(now) };
    default:
      return {};
  }
}

type Row = { id: string; label: string; sub?: string; requests: number; spend: number; lastUsedAt: string | null; children?: Row[] };

/** #13: spend of a cost center by user (with their keys), by key or by model, for a chosen range. */
export function CostCenterUsage({ id, range, setRange }: { id: string; range: UsageRange; setRange: (r: UsageRange) => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<UsageGroup>('user');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const detail = useReportDetail(id, usageRange(range));

  const rows = useMemo<Row[]>(() => {
    const d = detail.data;
    if (!d) return [];
    const byRequests = (a: Row, b: Row) => b.requests - a.requests || b.spend - a.spend;
    if (group === 'model') return d.byModel.map((m) => ({ id: m.model, label: m.model, requests: m.requests, spend: m.spend, lastUsedAt: m.lastUsedAt })).sort(byRequests);
    const keyRow = (k: (typeof d.users)[number]['keys'][number], owner?: string): Row => ({
      id: k.keyId ?? `${owner}-unknown`,
      label: k.keyName,
      sub: owner,
      requests: k.requests,
      spend: k.spend,
      lastUsedAt: k.lastUsedAt,
    });
    if (group === 'key') return d.users.flatMap((u) => u.keys.map((k) => keyRow(k, u.user.name))).sort(byRequests);
    return d.users
      .map((u) => ({ id: u.user.id, label: u.user.name, sub: u.user.email, requests: u.requests, spend: u.spend, lastUsedAt: u.lastUsedAt, children: u.keys.map((k) => keyRow(k)).sort(byRequests) }))
      .sort(byRequests);
  }, [detail.data, group]);

  const total = detail.data?.summary.requests ?? 0;
  const share = (n: number) => (total ? n / total : 0);
  const keyCount = detail.data ? detail.data.users.reduce((a, u) => a + u.keys.length, 0) : 0;

  const toggle = (rowId: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(rowId)) n.delete(rowId);
      else n.add(rowId);
      return n;
    });

  const line = (r: Row, depth: number) => (
    <TableRow key={`${depth}-${r.id}`} className={depth === 0 && r.children ? 'bg-muted/30' : undefined} data-testid={depth === 0 ? 'usage-row' : 'usage-row-child'}>
      <TableCell>
        <div className="flex items-center gap-2" style={{ paddingLeft: depth * 24 }}>
          {r.children?.length ? (
            <button type="button" onClick={() => toggle(r.id)} aria-expanded={!collapsed.has(r.id)} aria-label={r.label} className="text-muted-foreground">
              {collapsed.has(r.id) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          ) : null}
          <div className="min-w-0">
            <div className={depth === 0 ? 'truncate font-medium' : 'truncate'}>{r.label}</div>
            {r.sub ? <div className="text-muted-foreground truncate text-xs">{r.sub}</div> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtNumber(r.requests)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Progress value={share(r.requests) * 100} className="w-32" indicatorClassName={depth > 0 ? 'bg-muted-foreground/60' : undefined} />
          <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">{Math.round(share(r.requests) * 100)} %</span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtMoney(r.spend, { precise: true })}</TableCell>
      <TableCell className="text-muted-foreground text-right text-xs whitespace-nowrap">{r.lastUsedAt ? fmtDateTime(r.lastUsedAt) : '–'}</TableCell>
    </TableRow>
  );

  return (
    <section className="flex flex-col gap-3" data-testid="tab-usage">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('ccDetail.usageTitle')}</h2>
          {detail.data ? <p className="text-muted-foreground text-xs">{t('ccDetail.usageSummary', { users: detail.data.users.length, keys: keyCount, requests: fmtNumber(total) })}</p> : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('ccDetail.range')} htmlFor="usage-range">
            <SimpleSelect
              id="usage-range"
              value={range}
              onValueChange={(v) => setRange(v as UsageRange)}
              options={(['current', 'last', '30d', '90d', 'year'] as const).map((r) => ({ value: r, label: t(`ccDetail.ranges.${r}`) }))}
              className="w-44"
              testId="input-usage-range"
            />
          </Field>
          <Field label={t('ccDetail.groupBy')} htmlFor="usage-group">
            <SimpleSelect
              id="usage-group"
              value={group}
              onValueChange={(v) => setGroup(v as UsageGroup)}
              options={(['user', 'key', 'model'] as const).map((g) => ({ value: g, label: t(`ccDetail.groups.${g}`) }))}
              className="w-36"
              testId="input-usage-group"
            />
          </Field>
        </div>
      </div>
      <div className="rounded-md border">
        <Table data-testid="table-usage">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t(`ccDetail.groupHeads.${group}`)}</TableHead>
              <TableHead className="text-right">{t('reports.requests')}</TableHead>
              <TableHead>{t('ccDetail.shareRequests')}</TableHead>
              <TableHead className="text-right">{t('common.spend')}</TableHead>
              <TableHead className="text-right">{t('ccDetail.lastUsed')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.isLoading ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground h-20 text-center">
                  {t('ccDetail.noUsage')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <Fragment key={r.id}>
                  {line(r, 0)}
                  {!collapsed.has(r.id) ? r.children?.map((c) => line(c, 1)) : null}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
