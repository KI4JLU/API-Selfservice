import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Pencil, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { requireAdmin } from '@/lib/guards';
import { useAdminProviders, useSyncProviders, useUpdateProvider, type Provider } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Banner, PageHeader } from '@/components/ui/page';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WithTooltip } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/label';
import { TierBadge } from '@/components/StatusBadge';
import { ModelPrice } from '@/components/ModelPrice';

export const Route = createFileRoute('/_app/admin/providers')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: AdminProvidersPage,
});

function AdminProvidersPage() {
  const { t } = useTranslation();
  const providers = useAdminProviders();
  const update = useUpdateProvider();
  const sync = useSyncProviders();
  const [editing, setEditing] = useState<Provider | null>(null);

  const onSync = async () => {
    const res = await sync.mutateAsync().catch(() => null);
    if (res) toast.success(t('providers.synced', res), { testId: 'toast-providers-synced' });
  };

  const toggleTier = async (p: Provider, paid: boolean) => {
    const res = await update.mutateAsync({ id: p.id, body: { tier: paid ? 'paid' : 'free' } }).catch(() => null);
    if (res) toast.success(t('providers.tierSaved', { model: p.modelName, tier: t(`tier.${res.tier}`) }));
  };

  const withoutProvider = (providers.data ?? []).filter((p) => p.available && p.provider === null).length;

  const columns = useMemo<ColumnDef<Provider>[]>(
    () => [
      {
        header: t('providers.model'),
        accessorKey: 'modelName',
        cell: ({ row }) => (
          <div>
            <button
              type="button"
              className="cursor-pointer text-left font-mono text-sm font-medium underline-offset-4 hover:underline"
              onClick={() => setEditing(row.original)}
              data-testid="provider-model"
            >
              {row.original.modelName}
            </button>
            {row.original.litellmModelId ? <div className="text-muted-foreground text-xs">{row.original.litellmModelId}</div> : null}
          </div>
        ),
      },
      {
        header: t('providers.provider'),
        accessorKey: 'provider',
        // F-KEY-10: without a provider the model never reaches keys that hold a whole provider
        cell: ({ row }) =>
          row.original.provider ?? (
            <WithTooltip text={t('providers.noProviderHint')}>
              <Badge variant="outline" data-testid="badge-no-provider">
                <TriangleAlert className="text-warning" />
                {t('providers.noProvider')}
              </Badge>
            </WithTooltip>
          ),
      },
      {
        header: t('providers.price'),
        id: 'price',
        cell: ({ row }) => <ModelPrice provider={row.original} />,
        meta: { className: 'whitespace-nowrap' },
      },
      {
        header: t('providers.tier'),
        accessorKey: 'tier',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={row.original.tier === 'paid'}
              onCheckedChange={(v) => toggleTier(row.original, v)}
              disabled={update.isPending}
              aria-label={t('providers.tier')}
              data-testid="switch-tier"
            />
            <TierBadge tier={row.original.tier} />
          </div>
        ),
      },
      {
        header: t('providers.displayName'),
        id: 'display',
        cell: ({ row }) => (
          <div className="text-sm">
            <div>
              <span className="text-xs text-muted-foreground">DE </span>
              {row.original.displayNameDe ?? <span className="text-muted-foreground">–</span>}
            </div>
            <div>
              <span className="text-xs text-muted-foreground">EN </span>
              {row.original.displayNameEn ?? <span className="text-muted-foreground">–</span>}
            </div>
          </div>
        ),
      },
      {
        header: t('providers.available'),
        accessorKey: 'available',
        cell: ({ row }) =>
          row.original.available ? (
            <Badge variant="outline">{t('common.yes')}</Badge>
          ) : (
            <Badge variant="secondary" title={t('providers.unavailable')}>
              {t('providers.unavailable')}
            </Badge>
          ),
      },
      { header: t('providers.lastSeen'), accessorKey: 'lastSeenAt', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDateTime(row.original.lastSeenAt)}</span> },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditing(row.original)} data-testid="btn-edit-provider">
              <Pencil />
              <span className="hidden sm:inline">{t('common.edit')}</span>
            </Button>
          </div>
        ),
        meta: { className: 'text-right' },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, update.isPending],
  );

  return (
    <div data-testid="page-admin-providers">
      <PageHeader
        title={t('providers.title')}
        subtitle={t('providers.subtitle')}
        actions={
          <Button variant="outline" onClick={onSync} loading={sync.isPending} data-testid="btn-sync-providers">
            <RefreshCw />
            {t('providers.sync')}
          </Button>
        }
      />
      {withoutProvider > 0 ? (
        <Banner variant="warning" className="mb-4" testId="hint-no-provider">
          {t('providers.noProviderBanner', { count: withoutProvider })}
        </Banner>
      ) : null}
      <DataTable
        columns={columns}
        data={providers.data ?? []}
        isLoading={providers.isLoading}
        testId="table-providers"
        rowClassName={(p) => (p.available ? undefined : 'opacity-50')}
        getRowId={(p) => p.id}
        groupBy={(p) => p.provider ?? ''}
        groupLabel={(provider, rows) => (
          <>
            {provider || t('providers.noProvider')}
            <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
          </>
        )}
      />
      <ProviderEditDialog provider={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ProviderEditDialog({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateProvider();
  const [form, setForm] = useState({ displayNameDe: '', displayNameEn: '', descriptionDe: '', descriptionEn: '' });
  useEffect(() => {
    if (provider)
      setForm({
        displayNameDe: provider.displayNameDe ?? '',
        displayNameEn: provider.displayNameEn ?? '',
        descriptionDe: provider.descriptionDe ?? '',
        descriptionEn: provider.descriptionEn ?? '',
      });
  }, [provider]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
    const res = await update.mutateAsync({ id: provider.id, body }).catch(() => null);
    if (res) {
      toast.success(t('providers.saved'));
      onClose();
    }
  };
  return (
    <Dialog open={!!provider} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-edit-provider">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('providers.editTitle')}</DialogTitle>
            <DialogDescription className="font-mono">{provider?.modelName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t('providers.displayName')} (DE)`} htmlFor="p-dn-de">
              <Input id="p-dn-de" maxLength={200} value={form.displayNameDe} onChange={set('displayNameDe')} data-testid="input-display-name-de" />
            </Field>
            <Field label={`${t('providers.displayName')} (EN)`} htmlFor="p-dn-en">
              <Input id="p-dn-en" maxLength={200} value={form.displayNameEn} onChange={set('displayNameEn')} data-testid="input-display-name-en" />
            </Field>
          </div>
          <Field label={`${t('providers.description')} (DE)`} htmlFor="p-d-de">
            <Textarea id="p-d-de" maxLength={2000} value={form.descriptionDe} onChange={set('descriptionDe')} data-testid="input-description-de" />
          </Field>
          <Field label={`${t('providers.description')} (EN)`} htmlFor="p-d-en">
            <Textarea id="p-d-en" maxLength={2000} value={form.descriptionEn} onChange={set('descriptionEn')} data-testid="input-description-en" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending} data-testid="btn-save-provider">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
