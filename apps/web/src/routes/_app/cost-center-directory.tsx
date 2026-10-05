import { useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { useCostCenterLookup, useCreateJoinRequest, useMe, useMyJoinRequests, type CostCenterJoinRequest } from '@/lib/queries';
import { PageHeader, Toolbar } from '@/components/ui/page';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/label';
import { WithTooltip } from '@/components/ui/tooltip';

export const Route = createFileRoute('/_app/cost-center-directory')({
  component: CostCenterDirectoryPage,
});

type Row = { id: string; name: string; isDefault: boolean };

/**
 * F-KST-16: approved cost centers, searchable by name. The user's own ones (the default included) are listed on top.
 * Users see names only, never the internal cost center number.
 */
function CostCenterDirectoryPage() {
  const { t } = useTranslation();
  // Live query, not the route context: an approval elsewhere must show up without a reload.
  const me = useMe().data ?? Route.useRouteContext().me;
  const [q, setQ] = useState('');
  const list = useCostCenterLookup(q.trim() || undefined);
  const myRequests = useMyJoinRequests();
  const [joining, setJoining] = useState<Row | null>(null);

  const memberRole = new Map(me.memberCostCenters.map((c) => [c.id, c.role]));
  // Newest request per cost center (the API returns newest first).
  const latestRequest = new Map<string, CostCenterJoinRequest>();
  for (const r of myRequests.data ?? []) if (!latestRequest.has(r.costCenter.id)) latestRequest.set(r.costCenter.id, r);

  // The API lists the default first in memberCostCenters, followed by every membership.
  const allOwn: Row[] = me.memberCostCenters.map((c, i) => ({ id: c.id, name: c.name, isDefault: i === 0 }));
  // Without a search all own cost centers are on top; a search filters them by name like the others.
  const needle = q.trim().toLowerCase();
  const own = needle ? allOwn.filter((c) => c.name.toLowerCase().includes(needle)) : allOwn;
  const ownIds = new Set(allOwn.map((c) => c.id));
  const rows: Row[] = [...own, ...(list.data?.items ?? []).filter((c) => !ownIds.has(c.id)).map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault }))];

  const columns: ColumnDef<Row>[] = [
    {
      header: t('costCenters.name'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium">
          {row.original.name}
          {row.original.isDefault ? <Badge variant="secondary">{t('costCenters.default')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('common.status'),
      cell: ({ row }) => {
        const c = row.original;
        const role = memberRole.get(c.id) ?? (c.isDefault ? 'user' : undefined);
        if (role)
          return (
            <Badge variant="outline" data-testid="cc-membership" data-status="member">
              {t(`members.roles.${role}`)}
            </Badge>
          );
        const req = latestRequest.get(c.id);
        if (!req || req.status === 'approved') return null;
        const badge = (
          <Badge variant={req.status === 'rejected' ? 'destructive' : 'outline'} data-testid="cc-membership" data-status={req.status}>
            {t(`joinRequests.status.${req.status}`)}
          </Badge>
        );
        return req.status === 'rejected' && req.reason ? <WithTooltip text={t('joinRequests.rejectedReason', { reason: req.reason })}>{badge}</WithTooltip> : badge;
      },
    },
    {
      id: 'actions',
      header: t('common.actions'),
      cell: ({ row }) => {
        const c = row.original;
        if (c.isDefault || memberRole.has(c.id) || latestRequest.get(c.id)?.status === 'pending') return null;
        return (
          <Button variant="outline" size="sm" onClick={() => setJoining(c)} data-testid="btn-join-cost-center">
            <UserPlus />
            {t('joinRequests.join')}
          </Button>
        );
      },
      meta: { className: 'text-right' },
    },
  ];

  return (
    <div data-testid="page-cost-center-directory">
      <PageHeader title={t('joinRequests.title')} subtitle={t('joinRequests.subtitle')} />
      <Toolbar>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('joinRequests.searchPlaceholder')} className="sm:w-72" data-testid="input-cost-center-search" />
      </Toolbar>
      <DataTable columns={columns} data={rows} isLoading={list.isLoading} testId="table-cost-center-directory" emptyText={t('joinRequests.empty')} />
      <JoinDialog costCenter={joining} onClose={() => setJoining(null)} />
    </div>
  );
}

function JoinDialog({ costCenter, onClose }: { costCenter: Row | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const create = useCreateJoinRequest();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!costCenter) return;
    const res = await create.mutateAsync({ costCenterId: costCenter.id, message: message.trim() || undefined }).catch(() => null);
    if (res) {
      toast.success(t('joinRequests.sent', { name: costCenter.name }), { testId: 'toast-join-requested' });
      setMessage('');
      onClose();
    }
  };

  return (
    <Dialog open={!!costCenter} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-join-cost-center">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('joinRequests.joinTitle')}</DialogTitle>
            <DialogDescription>{t('joinRequests.joinHint', { name: costCenter?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <Field label={t('joinRequests.messageLabel')} htmlFor="join-message">
            <Textarea
              id="join-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('joinRequests.messagePlaceholder')}
              maxLength={1000}
              data-testid="input-join-message"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="btn-send-join-request">
              {t('joinRequests.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
