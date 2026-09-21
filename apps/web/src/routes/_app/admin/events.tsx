import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import { AUDIT_ENTITIES, AUDIT_SEVERITIES, type AuditSeverity } from '@litelite/shared';
import { requireAdmin } from '@/lib/guards';
import { useEvents, type AuditEvent } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/_app/admin/events')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminEventsPage,
});

const ALL = '__all__';
const PAGE_SIZE = 50;

const severityLook: Record<AuditSeverity, { variant: 'outline' | 'destructive'; icon: React.ComponentType<{ className?: string }>; iconClass?: string }> = {
  info: { variant: 'outline', icon: Info, iconClass: 'text-sky-600 dark:text-sky-500' },
  warning: { variant: 'outline', icon: TriangleAlert, iconClass: 'text-amber-600 dark:text-amber-500' },
  error: { variant: 'destructive', icon: CircleX },
};

function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const { t } = useTranslation();
  const look = severityLook[severity];
  const Icon = look.icon;
  return (
    <Badge variant={look.variant} data-severity={severity}>
      <Icon className={look.iconClass} />
      {t(`severity.${severity}`)}
    </Badge>
  );
}

function AdminEventsPage() {
  const { t } = useTranslation();
  const [severity, setSeverity] = useState(ALL);
  const [entity, setEntity] = useState(ALL);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const list = useEvents({
    severity: severity === ALL ? undefined : severity,
    entity: entity === ALL ? undefined : entity,
    action: action.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns = useMemo<ColumnDef<AuditEvent>[]>(
    () => [
      { header: t('events.time'), accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(row.original.createdAt)}</span> },
      { header: t('events.severity'), accessorKey: 'severity', cell: ({ row }) => <SeverityBadge severity={row.original.severity} /> },
      {
        header: t('events.action'),
        accessorKey: 'action',
        cell: ({ row }) => (
          <div>
            <div>{t(`auditActions.${row.original.action}`, { defaultValue: row.original.action })}</div>
            <div className="text-muted-foreground font-mono text-xs" data-testid="event-action">
              {row.original.action}
            </div>
          </div>
        ),
      },
      {
        header: t('events.entity'),
        accessorKey: 'entity',
        cell: ({ row }) => (
          <div>
            <div className="max-w-xs truncate" title={row.original.entityLabel ?? row.original.entityId ?? ''}>
              {row.original.entityLabel ?? row.original.entityId ?? '–'}
            </div>
            <div className="text-muted-foreground text-xs">{t(`auditEntities.${row.original.entity}`, { defaultValue: row.original.entity })}</div>
          </div>
        ),
      },
      {
        header: t('events.actor'),
        accessorKey: 'actor',
        cell: ({ row }) =>
          row.original.actor ? (
            <div>
              <div>{row.original.actor.name}</div>
              <div className="text-muted-foreground text-xs">{row.original.actor.email}</div>
            </div>
          ) : (
            <span className="text-muted-foreground">{t('events.system')}</span>
          ),
      },
    ],
    [t],
  );

  return (
    <div data-testid="page-admin-events">
      <PageHeader title={t('events.title')} subtitle={t('events.subtitle')} />
      <Toolbar>
        <Field label={t('events.severity')} htmlFor="e-severity">
          <SimpleSelect
            id="e-severity"
            value={severity}
            onValueChange={(v) => {
              setSeverity(v);
              setPage(1);
            }}
            options={[{ value: ALL, label: t('common.all') }, ...AUDIT_SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) }))]}
            className="w-40"
            testId="input-event-severity"
          />
        </Field>
        <Field label={t('events.entity')} htmlFor="e-entity">
          <SimpleSelect
            id="e-entity"
            value={entity}
            onValueChange={(v) => {
              setEntity(v);
              setPage(1);
            }}
            options={[{ value: ALL, label: t('common.all') }, ...AUDIT_ENTITIES.map((e) => ({ value: e, label: t(`auditEntities.${e}`) }))]}
            className="w-48"
            testId="input-event-entity"
          />
        </Field>
        <Field label={t('events.action')} htmlFor="e-action">
          <Input
            id="e-action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder={t('events.actionFilter')}
            className="w-64"
            data-testid="input-event-action"
          />
        </Field>
      </Toolbar>
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        isLoading={list.isLoading}
        testId="table-events"
        getRowId={(e) => e.id}
        onRowClick={(e) => setExpandedId((cur) => (cur === e.id ? null : e.id))}
        expandedId={expandedId}
        renderExpanded={(row) => (
          <div className="grid gap-2 text-sm" data-testid="event-detail">
            <div className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span>{t('events.entityId')}</span>
              <span className="font-mono text-xs">{row.original.entityId ?? '–'}</span>
              <span>{t('events.details')}</span>
              {row.original.payload ? (
                <pre className="bg-muted overflow-x-auto rounded-md p-2 font-mono text-xs">{JSON.stringify(row.original.payload, null, 2)}</pre>
              ) : (
                <span>{t('events.noDetails')}</span>
              )}
            </div>
          </div>
        )}
      />
      <div className="mt-3">
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPageChange={setPage} />
      </div>
    </div>
  );
}
