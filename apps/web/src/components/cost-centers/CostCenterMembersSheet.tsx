import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { COST_CENTER_MEMBER_ROLES, type CostCenterMemberRole } from '@api-selfservice/shared';
import {
  useAddMember,
  useApproveJoinRequest,
  useCostCenterMembers,
  useMe,
  useMemberCandidates,
  usePendingJoinRequests,
  useRejectJoinRequest,
  useRemoveMember,
  useUpdateMember,
  type CostCenterJoinRequest,
  type CostCenterMember,
  type MemberCandidate,
} from '@/lib/queries';
import { fmtCostCenter, fmtDateTime } from '@/lib/format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { WithTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '@/components/StatusBadge';
import { BulkAddMembersDialog } from './BulkAddMembersDialog';

type CostCenterRef = { id: string; number: string; name: string; ownerUserId?: string | null };

/** F-KST-10 to F-KST-13: members and cost center admins of one cost center (= its LiteLLM team). */
export function CostCenterMembersSheet({ costCenter, onClose }: { costCenter: CostCenterRef | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  // Mirrors the API (F-KST-13): only the owner and global admins appoint, demote or remove cost center admins.
  const canManageAdmins = me?.role === 'admin' || (!!costCenter?.ownerUserId && me?.id === costCenter.ownerUserId);
  return (
    <Sheet open={!!costCenter} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl" data-testid="sheet-cost-center-members">
        <SheetHeader>
          <SheetTitle>{t('members.title')}</SheetTitle>
          <SheetDescription>{costCenter ? `${fmtCostCenter(costCenter.number)} · ${costCenter.name}` : ''}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4">
          {costCenter ? (
            <>
              <JoinRequests id={costCenter.id} />
              <AddMember id={costCenter.id} canManageAdmins={canManageAdmins} />
              <MemberList id={costCenter.id} ownerUserId={costCenter.ownerUserId ?? null} canManageAdmins={canManageAdmins} />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** F-KST-16: open join requests; approving adds the requester as plain member. */
function JoinRequests({ id }: { id: string }) {
  const { t } = useTranslation();
  const requests = usePendingJoinRequests(id);
  const approve = useApproveJoinRequest();
  const reject = useRejectJoinRequest();
  const [rejecting, setRejecting] = useState<CostCenterJoinRequest | null>(null);
  const [reason, setReason] = useState('');
  const items = requests.data ?? [];

  const onApprove = async (r: CostCenterJoinRequest) => {
    const res = await approve.mutateAsync({ id, requestId: r.id }).catch(() => null);
    if (res) toast.success(t('joinRequests.approved', { name: r.user.name }));
  };

  const onReject = async () => {
    if (!rejecting || !reason.trim()) return;
    const res = await reject.mutateAsync({ id, requestId: rejecting.id, reason: reason.trim() }).catch(() => null);
    if (res) {
      toast.success(t('joinRequests.rejected', { name: rejecting.user.name }));
      setRejecting(null);
      setReason('');
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="section-join-requests">
      <div className="text-sm font-medium">
        {t('joinRequests.listTitle')} {requests.data ? <span className="text-muted-foreground">({items.length})</span> : null}
      </div>
      {requests.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : items.length === 0 ? (
        <div className="text-muted-foreground text-sm" data-testid="join-requests-empty">
          {t('joinRequests.noneOpen')}
        </div>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="list-join-requests">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2" data-testid="item-join-request">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.user.name}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {r.user.email} · {fmtDateTime(r.createdAt)}
                </div>
                {r.message ? <p className="mt-1 text-sm whitespace-pre-line">{r.message}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onApprove(r)} loading={approve.isPending && approve.variables?.requestId === r.id} data-testid="btn-approve-join-request">
                  <Check />
                  {t('joinRequests.approve')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(r)} data-testid="btn-reject-join-request">
                  <X />
                  {t('joinRequests.reject')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => {
          if (!o) {
            setRejecting(null);
            setReason('');
          }
        }}
        title={t('joinRequests.rejectTitle')}
        description={rejecting ? `${rejecting.user.name} · ${rejecting.user.email}` : ''}
        confirmLabel={t('joinRequests.reject')}
        destructive
        loading={reject.isPending}
        onConfirm={onReject}
        testId="dialog-reject-join-request"
      >
        <Field label={t('joinRequests.reasonLabel')} htmlFor="join-reject-reason" required>
          <Textarea id="join-reject-reason" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-testid="input-join-reject-reason" />
        </Field>
      </ConfirmDialog>
    </section>
  );
}

function useRoleOptions() {
  const { t } = useTranslation();
  return COST_CENTER_MEMBER_ROLES.map((r) => ({ value: r, label: t(`members.roles.${r}`) }));
}

function AddMember({ id, canManageAdmins }: { id: string; canManageAdmins: boolean }) {
  const { t } = useTranslation();
  const roleOptions = useRoleOptions();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<CostCenterMemberRole>('user');
  const [bulkOpen, setBulkOpen] = useState(false);
  const candidates = useMemberCandidates(id, q);
  const add = useAddMember();

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(qInput.trim());
  };

  const onAdd = async (c: MemberCandidate) => {
    const res = await add.mutateAsync({ id, userId: c.userId, role: canManageAdmins ? role : 'user' }).catch(() => null);
    if (res) toast.success(t('members.added', { email: c.email ?? c.userId }));
  };

  return (
    <section className="flex flex-col gap-3" data-testid="section-add-member">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t('members.addTitle')}</div>
          <p className="text-muted-foreground text-sm">{t('members.addHint')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} data-testid="btn-bulk-add-members">
          <Users />
          {t('members.bulkAdd')}
        </Button>
      </div>
      <BulkAddMembersDialog costCenterId={id} open={bulkOpen} onOpenChange={setBulkOpen} canManageAdmins={canManageAdmins} />
      <form onSubmit={onSearch} className="flex flex-wrap items-end gap-2">
        <Field label={t('common.search')} htmlFor="member-q" className="min-w-56 flex-1">
          <Input id="member-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t('members.searchPlaceholder')} required minLength={3} data-testid="input-member-search" />
        </Field>
        {canManageAdmins ? (
          <Field label={t('common.role')} htmlFor="member-role">
            <SimpleSelect id="member-role" value={role} onValueChange={(v) => setRole(v as CostCenterMemberRole)} options={roleOptions} className="w-44" testId="input-new-member-role" />
          </Field>
        ) : null}
        <Button type="submit" variant="outline" size="icon" aria-label={t('common.search')} data-testid="btn-member-search">
          <Search />
        </Button>
      </form>
      {q.length < 3 ? null : candidates.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : (candidates.data ?? []).length === 0 ? (
        <div className="text-muted-foreground text-sm" data-testid="member-candidates-empty">
          {t('members.noCandidates')}
        </div>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="list-member-candidates">
          {(candidates.data ?? []).map((c) => (
            <li key={c.userId} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="item-member-candidate">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.email ?? c.userId}</div>
                <div className="text-muted-foreground truncate text-xs">{[c.alias, c.hasAccount ? null : t('members.neverSignedIn')].filter(Boolean).join(' · ')}</div>
              </div>
              {c.isMember ? (
                <Badge variant="secondary">{t('members.alreadyMember')}</Badge>
              ) : (
                <Button size="sm" onClick={() => onAdd(c)} loading={add.isPending && add.variables?.userId === c.userId} data-testid="btn-add-member">
                  <UserPlus />
                  {t('members.add')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberList({ id, ownerUserId, canManageAdmins }: { id: string; ownerUserId: string | null; canManageAdmins: boolean }) {
  const { t } = useTranslation();
  const roleOptions = useRoleOptions();
  const members = useCostCenterMembers(id);
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const [removing, setRemoving] = useState<CostCenterMember | null>(null);

  const items = members.data ?? [];
  // Mirrors the API: the owner stays admin (F-KST-14); every role change and removing an admin is for the owner (F-KST-13).
  const isOwner = (m: CostCenterMember) => m.userId === ownerUserId;
  const ownerOnly = canManageAdmins ? undefined : t('errors.COST_CENTER_OWNER_ONLY');
  const roleLock = (m: CostCenterMember) => (isOwner(m) ? t('errors.COST_CENTER_OWNER_MUST_BE_ADMIN') : ownerOnly);
  const removeLock = (m: CostCenterMember) => (isOwner(m) ? t('errors.COST_CENTER_OWNER_MUST_BE_ADMIN') : m.role === 'admin' ? ownerOnly : undefined);
  const label = (m: CostCenterMember) => m.name ?? m.email ?? m.userId;

  const onRole = async (m: CostCenterMember, role: string) => {
    const res = await update.mutateAsync({ id, userId: m.userId, role: role as CostCenterMemberRole }).catch(() => null);
    if (res) toast.success(t('members.roleChanged', { name: label(m) }));
  };

  const onRemove = async () => {
    if (!removing) return;
    const res = await remove.mutateAsync({ id, userId: removing.userId }).catch(() => null);
    if (res) {
      toast.success(t('members.removed', { name: label(removing) }));
      setRemoving(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="text-sm font-medium">
        {t('members.listTitle')} {members.data ? <span className="text-muted-foreground">({items.length})</span> : null}
      </div>
      <div className="rounded-md border">
        <Table data-testid="table-cost-center-members">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t('common.name')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('common.role')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isLoading ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-20 text-center">
                  {t('members.empty')}
                </TableCell>
              </TableRow>
            ) : (
              items.map((m) => (
                <TableRow key={m.userId} data-testid="row-member" data-user-id={m.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {label(m)}
                      {isOwner(m) ? (
                        <Badge variant="secondary" data-testid="badge-member-owner">
                          {t('members.owner')}
                        </Badge>
                      ) : null}
                    </div>
                    {m.name && m.email ? <div className="text-muted-foreground text-xs">{m.email}</div> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} testId="member-status" />
                  </TableCell>
                  <TableCell>
                    <WithTooltip text={roleLock(m)}>
                      <SimpleSelect
                        value={m.role}
                        onValueChange={(v) => onRole(m, v)}
                        options={roleOptions}
                        disabled={roleLock(m) !== undefined || update.isPending}
                        className="w-44"
                        testId="input-member-role"
                      />
                    </WithTooltip>
                  </TableCell>
                  <TableCell className="text-right">
                    <WithTooltip text={removeLock(m) ?? t('members.remove')}>
                      <Button variant="ghost" size="icon" disabled={removeLock(m) !== undefined} onClick={() => setRemoving(m)} aria-label={t('members.remove')} data-testid="btn-remove-member">
                        <UserMinus />
                      </Button>
                    </WithTooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('members.removeTitle')}
        description={removing ? t('members.removeConfirm', { name: label(removing) }) : undefined}
        confirmLabel={t('members.remove')}
        destructive
        loading={remove.isPending}
        onConfirm={onRemove}
        testId="dialog-remove-member"
      />
    </section>
  );
}
