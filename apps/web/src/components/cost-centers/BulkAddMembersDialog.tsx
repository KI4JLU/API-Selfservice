import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MEMBER_BULK_MAX, COST_CENTER_MEMBER_ROLES, type CostCenterMemberRole } from '@api-selfservice/shared';
import { useBulkAddMembers, useResolveMemberEmails, type ResolvedMemberEmails } from '@/lib/queries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Banner } from '@/components/ui/page';
import { CopyButton } from '@/components/CopyButton';

/** Splits pasted text at comma, semicolon and line breaks; "Name <a@b.de>" yields a@b.de. Duplicates are dropped. */
export function parseEmailList(text: string): string[] {
  const out = new Map<string, string>();
  for (const part of text.split(/[,;\n\r]+/)) {
    const angle = part.match(/<([^>]+)>/);
    const tokens = angle ? [angle[1]!] : part.split(/\s+/);
    for (const raw of tokens) {
      const e = raw.trim().replace(/^mailto:/i, '');
      if (e && !out.has(e.toLowerCase())) out.set(e.toLowerCase(), e);
    }
  }
  return [...out.values()];
}

/** Bulk add (F-KST-11): paste addresses, resolve them against LiteLLM, add all found users at once. */
export function BulkAddMembersDialog({ costCenterId, open, onOpenChange, canManageAdmins }: { costCenterId: string; open: boolean; onOpenChange: (o: boolean) => void; canManageAdmins: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [role, setRole] = useState<CostCenterMemberRole>('user');
  const [result, setResult] = useState<ResolvedMemberEmails | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<{ label: string; code: string }[]>([]);
  const resolve = useResolveMemberEmails();
  const bulk = useBulkAddMembers();

  useEffect(() => {
    if (open) {
      setText('');
      setRole('user');
      setResult(null);
      setSelected(new Set());
      setFailed([]);
    }
  }, [open]);

  const emails = useMemo(() => parseEmailList(text), [text]);
  const tooMany = emails.length > MEMBER_BULK_MAX;

  const onResolve = async (e: FormEvent) => {
    e.preventDefault();
    if (!emails.length || tooMany) return;
    const res = await resolve.mutateAsync({ id: costCenterId, emails }).catch(() => null);
    if (!res) return;
    setResult(res);
    setSelected(new Set(res.found.filter((c) => !c.isMember).map((c) => c.userId)));
    setFailed([]);
  };

  const onAdd = async () => {
    if (!result || !selected.size) return;
    const res = await bulk.mutateAsync({ id: costCenterId, userIds: [...selected], role: canManageAdmins ? role : 'user' }).catch(() => null);
    if (!res) return;
    if (res.added.length) toast.success(t('members.bulkAdded', { count: res.added.length }), { testId: 'toast-bulk-added' });
    if (!res.failed.length) return onOpenChange(false);
    const byId = new Map(result.found.map((c) => [c.userId, c.email ?? c.userId]));
    setFailed(res.failed.map((f) => ({ label: byId.get(f.userId) ?? f.userId, code: f.code })));
    // Added users are members now; only the failed ones stay selectable.
    const addedIds = new Set(res.added.map((m) => m.userId));
    setResult({ ...result, found: result.found.map((c) => (addedIds.has(c.userId) ? { ...c, isMember: true } : c)) });
    setSelected(new Set());
  };

  const toggle = (userId: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(userId);
      else n.delete(userId);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="dialog-bulk-add-members">
        <DialogHeader>
          <DialogTitle>{t('members.bulkTitle')}</DialogTitle>
          <DialogDescription>{t('members.bulkHint')}</DialogDescription>
        </DialogHeader>

        {!result ? (
          <form onSubmit={onResolve} className="grid gap-4">
            <Field label={t('members.bulkInputLabel')} htmlFor="bulk-emails" hint={emails.length ? `${emails.length} / ${MEMBER_BULK_MAX}` : undefined}>
              <Textarea id="bulk-emails" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="anna@uni-giessen.de; ben@uni-giessen.de, …" data-testid="input-bulk-emails" />
            </Field>
            {tooMany ? (
              <Banner variant="danger" testId="bulk-too-many">
                {t('members.bulkTooMany', { max: MEMBER_BULK_MAX, count: emails.length })}
              </Banner>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!emails.length || tooMany} loading={resolve.isPending} data-testid="btn-bulk-resolve">
                {t('members.bulkResolve')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto">
            {failed.length ? (
              <Banner variant="danger" title={t('members.bulkFailed', { count: failed.length })} testId="bulk-failed">
                <ul className="list-disc pl-4">
                  {failed.map((f) => (
                    <li key={f.label}>
                      {f.label}: {t(`errors.${f.code}`, { defaultValue: f.code })}
                    </li>
                  ))}
                </ul>
              </Banner>
            ) : null}

            {result.notFound.length ? (
              <Banner variant="warning" title={t('members.bulkNotFound', { count: result.notFound.length })} testId="bulk-not-found">
                <p>{t('members.bulkNotFoundHint')}</p>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs break-all" data-testid="bulk-not-found-list">
                    {result.notFound.join('; ')}
                  </span>
                  <CopyButton value={result.notFound.join('; ')} />
                </div>
              </Banner>
            ) : null}

            {result.invalid.length ? (
              <Banner variant="danger" title={t('members.bulkInvalid', { count: result.invalid.length })} testId="bulk-invalid">
                <span className="font-mono text-xs break-all">{result.invalid.join('; ')}</span>
              </Banner>
            ) : null}

            {result.found.length ? (
              <section className="grid gap-2">
                <div className="text-sm font-medium">{t('members.bulkFound', { count: result.found.length })}</div>
                <ul className="divide-y rounded-md border" data-testid="list-bulk-found">
                  {result.found.map((c) => (
                    <li key={c.userId} className="flex items-center gap-3 px-3 py-2" data-testid="item-bulk-found">
                      <Checkbox checked={selected.has(c.userId)} disabled={c.isMember} onCheckedChange={(v) => toggle(c.userId, v === true)} aria-label={c.email ?? c.userId} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.email ?? c.userId}</div>
                        <div className="text-muted-foreground truncate text-xs">{[c.alias, c.hasAccount ? null : t('members.neverSignedIn')].filter(Boolean).join(' · ')}</div>
                      </div>
                      {c.isMember ? <Badge variant="secondary">{t('members.alreadyMember')}</Badge> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {canManageAdmins ? (
              <Field label={t('common.role')} htmlFor="bulk-role">
                <SimpleSelect
                  id="bulk-role"
                  value={role}
                  onValueChange={(v) => setRole(v as CostCenterMemberRole)}
                  options={COST_CENTER_MEMBER_ROLES.map((r) => ({ value: r, label: t(`members.roles.${r}`) }))}
                  className="w-44"
                  testId="input-bulk-role"
                />
              </Field>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResult(null)} data-testid="btn-bulk-back">
                {t('members.bulkBack')}
              </Button>
              <Button onClick={onAdd} disabled={!selected.size} loading={bulk.isPending} data-testid="btn-bulk-add">
                {t('members.bulkSubmit', { count: selected.size })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
