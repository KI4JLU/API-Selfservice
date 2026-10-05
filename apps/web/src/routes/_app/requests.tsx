import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useKeys, useLogs, useProviders, type RequestLog } from '@/lib/queries';
import { dateToIso, fmtDateTime, fmtMoney, fmtNumber, fmtSeconds } from '@/lib/format';
import { PageHeader, Toolbar, DescriptionList } from '@/components/ui/page';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/StatusBadge';
import { CopyButton } from '@/components/CopyButton';

export const Route = createFileRoute('/_app/requests')({
  component: RequestsPage,
});

const ALL = '__all__';
const PAGE_SIZE = 25;

function RequestsPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [model, setModel] = useState(ALL);
  const [keyId, setKeyId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [requestIdInput, setRequestIdInput] = useState('');
  const [requestId, setRequestId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RequestLog | null>(null);

  const params = {
    from: from ? dateToIso(from) : undefined,
    to: to ? dateToIso(to, true) : undefined,
    model: model === ALL ? undefined : model,
    keyId: keyId === ALL ? undefined : keyId,
    status: status === ALL ? undefined : (status as 'success' | 'failure'),
    requestId: requestId || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const logs = useLogs(params);
  const keys = useKeys();
  const providers = useProviders();

  const modelOptions = useMemo(() => {
    const set = new Set<string>((providers.data ?? []).map((p) => p.modelName));
    (logs.data?.items ?? []).forEach((l) => set.add(l.model));
    return [{ value: ALL, label: t('common.all') }, ...[...set].sort().map((m) => ({ value: m, label: m }))];
  }, [providers.data, logs.data, t]);

  const keyOptions = useMemo(() => [{ value: ALL, label: t('common.all') }, ...(keys.data?.items ?? []).map((k) => ({ value: k.id, label: k.name }))], [keys.data, t]);

  const columns = useMemo<ColumnDef<RequestLog>[]>(
    () => [
      { header: t('requests.time'), accessorKey: 'time', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(row.original.time)}</span> },
      { header: t('requests.type'), accessorKey: 'type', cell: ({ row }) => <Badge variant="secondary">{row.original.type}</Badge> },
      { header: t('common.status'), accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { header: t('requests.model'), accessorKey: 'model', cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span> },
      { header: t('requests.key'), accessorKey: 'keyName', cell: ({ row }) => row.original.keyName ?? '–' },
      { header: t('requests.cost'), accessorKey: 'cost', cell: ({ row }) => fmtMoney(row.original.cost, { precise: true }), meta: { className: 'text-right tabular-nums' } },
      { header: t('requests.duration'), accessorKey: 'durationMs', cell: ({ row }) => fmtSeconds(row.original.durationMs), meta: { className: 'text-right tabular-nums' } },
      { header: t('requests.ttft'), accessorKey: 'ttftMs', cell: ({ row }) => fmtSeconds(row.original.ttftMs), meta: { className: 'text-right tabular-nums' } },
      {
        header: t('requests.tokens'),
        id: 'tokens',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {fmtNumber(row.original.tokensIn)} <span className="text-muted-foreground">+</span> {fmtNumber(row.original.tokensOut)}
          </span>
        ),
        meta: { className: 'text-right' },
      },
      {
        header: t('requests.tags'),
        accessorKey: 'tags',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    [t],
  );

  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  return (
    <div data-testid="page-requests">
      <PageHeader title={t('requests.title')} subtitle={t('requests.subtitle')} />
      <Toolbar>
        <Field label={t('common.from')} htmlFor="log-from">
          <Input id="log-from" type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} className="w-40" data-testid="input-log-from" />
        </Field>
        <Field label={t('common.to')} htmlFor="log-to">
          <Input id="log-to" type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} className="w-40" data-testid="input-log-to" />
        </Field>
        <Field label={t('requests.model')} htmlFor="log-model">
          <SimpleSelect id="log-model" value={model} onValueChange={resetPage(setModel)} options={modelOptions} className="w-48" testId="input-log-model" />
        </Field>
        <Field label={t('requests.key')} htmlFor="log-key">
          <SimpleSelect id="log-key" value={keyId} onValueChange={resetPage(setKeyId)} options={keyOptions} className="w-44" testId="input-log-key" />
        </Field>
        <Field label={t('common.status')} htmlFor="log-status">
          <SimpleSelect
            id="log-status"
            value={status}
            onValueChange={resetPage(setStatus)}
            options={[
              { value: ALL, label: t('common.all') },
              { value: 'success', label: t('status.success') },
              { value: 'failure', label: t('status.failure') },
            ]}
            className="w-36"
            testId="input-log-status"
          />
        </Field>
        <Field label={t('requests.requestId')} htmlFor="log-rid">
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              resetPage(setRequestId)(requestIdInput.trim());
            }}
          >
            <Input
              id="log-rid"
              value={requestIdInput}
              onChange={(e) => setRequestIdInput(e.target.value)}
              placeholder={t('requests.searchRequestId')}
              className="w-56"
              data-testid="input-log-request-id"
            />
            <Button type="submit" variant="outline" size="icon" aria-label={t('common.search')}>
              <Search />
            </Button>
            {requestId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('common.close')}
                onClick={() => {
                  setRequestIdInput('');
                  resetPage(setRequestId)('');
                }}
              >
                <X />
              </Button>
            ) : null}
          </form>
        </Field>
      </Toolbar>
      <DataTable columns={columns} data={logs.data?.items ?? []} isLoading={logs.isLoading} testId="table-requests" onRowClick={setSelected} getRowId={(r) => r.requestId} />
      <div className="mt-3">
        <Pagination page={page} pageSize={PAGE_SIZE} total={logs.data?.total ?? 0} onPageChange={setPage} />
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent data-testid="sheet-request-detail" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('requests.detail')}</SheetTitle>
            <SheetDescription>{selected ? fmtDateTime(selected.time) : ''}</SheetDescription>
          </SheetHeader>
          {selected ? (
            <DescriptionList
              className="overflow-y-auto px-4 pb-4"
              items={[
                {
                  label: t('requests.requestId'),
                  value: (
                    <span className="flex items-center gap-2">
                      <code className="font-mono text-xs">{selected.requestId}</code>
                      <CopyButton value={selected.requestId} />
                    </span>
                  ),
                },
                { label: t('requests.sessionId'), value: selected.sessionId ? <code className="font-mono text-xs">{selected.sessionId}</code> : '–' },
                { label: t('requests.time'), value: fmtDateTime(selected.time) },
                { label: t('requests.type'), value: selected.type },
                { label: t('common.status'), value: <StatusBadge status={selected.status} /> },
                { label: t('requests.model'), value: <code className="font-mono text-xs">{selected.model}</code> },
                { label: t('requests.key'), value: selected.keyName ?? '–' },
                { label: t('requests.cost'), value: fmtMoney(selected.cost, { precise: true }) },
                { label: t('requests.duration'), value: fmtSeconds(selected.durationMs) },
                { label: t('requests.ttft'), value: fmtSeconds(selected.ttftMs) },
                { label: t('requests.tokensIn'), value: fmtNumber(selected.tokensIn) },
                { label: t('requests.tokensOut'), value: fmtNumber(selected.tokensOut) },
                { label: t('requests.tags'), value: selected.tags.length ? selected.tags.join(', ') : '–' },
                { label: t('requests.error'), value: selected.error ? <span className="text-destructive">{selected.error}</span> : '–' },
              ]}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
