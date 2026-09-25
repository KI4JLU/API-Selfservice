import { useMemo, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { requireAdmin } from '@/lib/guards';
import { useLitellmUsers, type LitellmUser } from '@/lib/queries';
import { fmtMoney } from '@/lib/format';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/CopyButton';
import { StatusBadge } from '@/components/StatusBadge';

export const Route = createFileRoute('/_app/admin/litellm-users')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminLitellmUsersPage,
});

const PAGE_SIZE = 25;

function AdminLitellmUsersPage() {
  const { t } = useTranslation();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const users = useLitellmUsers({ q: q || undefined, page, pageSize: PAGE_SIZE });

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(qInput.trim());
    setPage(1);
  };

  const columns = useMemo<ColumnDef<LitellmUser>[]>(
    () => [
      {
        header: t('common.email'),
        accessorKey: 'email',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium" data-testid="litellm-user-email">
              {row.original.email ?? '–'}
            </div>
            {row.original.alias ? <div className="truncate text-xs text-muted-foreground">{row.original.alias}</div> : null}
          </div>
        ),
      },
      {
        header: t('litellmUsers.userId'),
        accessorKey: 'userId',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            <span className="max-w-48 truncate" title={row.original.userId}>
              {row.original.userId}
            </span>
            <CopyButton value={row.original.userId} />
          </span>
        ),
      },
      { header: t('litellmUsers.teams'), accessorFn: (u) => u.teams.length, id: 'teams', meta: { className: 'text-right tabular-nums' } },
      { header: t('common.spend'), accessorKey: 'spend', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtMoney(row.original.spend, { precise: true })}</span>, meta: { className: 'text-right' } },
      { header: t('litellmUsers.maxBudget'), accessorKey: 'maxBudget', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.maxBudget === null ? t('common.unlimited') : fmtMoney(row.original.maxBudget)}</span>, meta: { className: 'text-right' } },
      {
        header: t('litellmUsers.inApiSelfservice'),
        accessorKey: 'apiSelfservice',
        cell: ({ row }) =>
          row.original.apiSelfservice ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-sm" data-testid="litellm-user-name">
                {row.original.apiSelfservice.name}
              </span>
              <StatusBadge status={row.original.apiSelfservice.status} testId="litellm-user-api-selfservice-status" />
              {row.original.blocked ? <Badge variant="destructive">{t('litellmUsers.blocked')}</Badge> : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground text-sm" data-testid="litellm-user-not-in-api-selfservice">
                {t('litellmUsers.notInApiSelfservice')}
              </span>
              {row.original.blocked ? <Badge variant="destructive">{t('litellmUsers.blocked')}</Badge> : null}
            </div>
          ),
      },
    ],
    [t],
  );

  return (
    <div data-testid="page-admin-litellm-users">
      <PageHeader title={t('litellmUsers.title')} subtitle={t('litellmUsers.subtitle')} />
      <Toolbar>
        <form onSubmit={onSearch} className="flex items-end gap-1">
          <Field label={t('common.search')} htmlFor="lu-q">
            <Input id="lu-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t('litellmUsers.searchPlaceholder')} className="w-80" data-testid="input-litellm-user-search" />
          </Field>
          <Button type="submit" variant="outline" size="icon" aria-label={t('common.search')} data-testid="btn-litellm-user-search">
            <Search />
          </Button>
        </form>
      </Toolbar>
      <p className="text-muted-foreground mb-3 text-sm">{t('litellmUsers.hint')}</p>
      {users.isError ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm" role="alert" data-testid="litellm-users-error">
          {t('litellmUsers.error')}
        </div>
      ) : (
        <>
          <DataTable columns={columns} data={users.data?.items ?? []} isLoading={users.isLoading} testId="table-litellm-users" getRowId={(u) => u.userId} />
          <div className="mt-3">
            <Pagination page={page} pageSize={PAGE_SIZE} total={users.data?.total ?? 0} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
