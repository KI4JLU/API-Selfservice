import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { NOTIFICATION_TYPES } from '@litelite/shared';
import { requireAdmin } from '@/lib/guards';
import { useNotifications, type Notification } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/StatusBadge';

export const Route = createFileRoute('/_app/admin/notifications')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminNotificationsPage,
});

const ALL = '__all__';
const PAGE_SIZE = 50;

function AdminNotificationsPage() {
  const { t } = useTranslation();
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const list = useNotifications({ type: type === ALL ? undefined : type, status: status === ALL ? undefined : status, page, pageSize: PAGE_SIZE });

  const columns = useMemo<ColumnDef<Notification>[]>(
    () => [
      { header: t('notifications.sentAt'), accessorKey: 'sentAt', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(row.original.sentAt)}</span> },
      { header: t('notifications.type'), accessorKey: 'type', cell: ({ row }) => <Badge variant="secondary">{t(`notificationTypes.${row.original.type}`, { defaultValue: row.original.type })}</Badge> },
      { header: t('notifications.recipient'), accessorKey: 'recipient' },
      { header: t('notifications.subject'), accessorKey: 'subject', cell: ({ row }) => <span className="line-clamp-2">{row.original.subject}</span> },
      { header: t('common.language'), accessorKey: 'locale', cell: ({ row }) => row.original.locale.toUpperCase() },
      {
        header: t('common.status'),
        accessorKey: 'status',
        cell: ({ row }) => (
          <div>
            <StatusBadge status={row.original.status} />
            {row.original.error ? <div className="mt-1 max-w-xs truncate text-xs text-destructive" title={row.original.error}>{row.original.error}</div> : null}
          </div>
        ),
      },
    ],
    [t],
  );

  return (
    <div data-testid="page-admin-notifications">
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
      <Toolbar>
        <Field label={t('notifications.type')} htmlFor="n-type">
          <SimpleSelect
            id="n-type"
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[{ value: ALL, label: t('common.all') }, ...NOTIFICATION_TYPES.map((n) => ({ value: n, label: t(`notificationTypes.${n}`) }))]}
            className="w-72"
            testId="input-notification-type"
          />
        </Field>
        <Field label={t('common.status')} htmlFor="n-status">
          <SimpleSelect
            id="n-status"
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: ALL, label: t('common.all') },
              { value: 'sent', label: t('status.sent') },
              { value: 'failed', label: t('status.failed') },
              { value: 'skipped', label: t('status.skipped') },
            ]}
            className="w-40"
            testId="input-notification-status"
          />
        </Field>
      </Toolbar>
      <DataTable columns={columns} data={list.data?.items ?? []} isLoading={list.isLoading} testId="table-notifications" getRowId={(n) => n.id} />
      <div className="mt-3">
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPageChange={setPage} />
      </div>
    </div>
  );
}
