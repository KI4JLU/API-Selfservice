import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Download } from 'lucide-react';
import { requireAdmin } from '@/lib/guards';
import { downloadSapExport, useCreateSapExport, useSapExports, useSapPreview, useSapSettings, useUpdateSapSettings, type SapExportPreview } from '@/lib/queries';
import { fmtCostCenter, fmtDateTime, fmtMoney } from '@/lib/format';
import { PageHeader, Banner } from '@/components/ui/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const Route = createFileRoute('/_app/admin/sap-export')({
  beforeLoad: ({ context }) => requireAdmin(context.me),
  component: SapExportPage,
});

const DEFAULT_TEXT = 'API-Kosten: {Provider}';

/** The last 12 months as YYYY-MM, newest first; the previous month is the default. */
function months(now = new Date()) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** Same format as the server's CSV, for "copy preview". */
function previewCsv(p: SapExportPreview) {
  const head = 'Belegdatum;Buchungsdatum;KoSt alt;KoSt_neu;Auftrag_neu;Text;Leistungsart';
  return [
    head,
    ...p.rows.map((r) => [r.documentDate, r.postingDate, r.senderCostCenter, r.recipientCostCenter ?? '', r.recipientOrder ?? '', r.text, r.amount.toFixed(2).replace('.', ',')].join(';')),
  ].join('\r\n');
}

/** #14: API costs of a billing month as CSV for the SAP import (LSMW), with history. */
function SapExportPage() {
  const { t, i18n } = useTranslation();
  const monthOptions = useMemo(() => months(), []);
  const [month, setMonth] = useState(monthOptions[1]!);
  const [documentDate, setDocumentDate] = useState(lastDay(monthOptions[1]!));
  const [postingDate, setPostingDate] = useState(lastDay(monthOptions[1]!));
  const [text, setText] = useState(DEFAULT_TEXT);
  const [sender, setSender] = useState('');
  const settings = useSapSettings();
  const saveSettings = useUpdateSapSettings();
  const preview = useSapPreview({ month, documentDate, postingDate, text: text.trim() || undefined });
  const history = useSapExports();
  const create = useCreateSapExport();

  useEffect(() => {
    if (settings.data) setSender(settings.data.senderCostCenter ?? '');
  }, [settings.data]);

  const changeMonth = (m: string) => {
    setMonth(m);
    setDocumentDate(lastDay(m));
    setPostingDate(lastDay(m));
  };
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(i18n.resolvedLanguage, { month: 'long', year: 'numeric' });
  const senderValid = /^\d{8}$/.test(sender);
  const senderDirty = sender !== (settings.data?.senderCostCenter ?? '');
  const p = preview.data;

  const onSaveSender = async () => {
    const res = await saveSettings.mutateAsync(sender).catch(() => null);
    if (res) toast.success(t('sap.senderSaved'), { testId: 'toast-sap-sender-saved' });
  };
  const onDownload = async () => {
    if (senderDirty && senderValid) await saveSettings.mutateAsync(sender).catch(() => null);
    const e = await create.mutateAsync({ month, documentDate, postingDate, text: text.trim() || undefined }).catch(() => null);
    if (!e) return;
    await downloadSapExport(e.id).catch(() => toast.error(t('errors.INTERNAL')));
    toast.success(t('sap.exported', { rows: e.rowCount }), { testId: 'toast-sap-exported' });
  };
  const onCopy = async () => {
    if (!p) return;
    await navigator.clipboard.writeText(previewCsv(p));
    toast.success(t('sap.copied'));
  };

  return (
    <div data-testid="page-admin-sap-export">
      <PageHeader title={t('sap.title')} subtitle={t('sap.subtitle')} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>1 · {t('sap.period')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label={t('sap.month')} htmlFor="sap-month">
              <SimpleSelect id="sap-month" value={month} onValueChange={changeMonth} options={monthOptions.map((m) => ({ value: m, label: monthLabel(m) }))} testId="input-sap-month" />
            </Field>
            <Field label={t('sap.documentDate')} htmlFor="sap-doc" hint={t('sap.dateHint')}>
              <Input id="sap-doc" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} data-testid="input-sap-document-date" />
            </Field>
            <Field label={t('sap.postingDate')} htmlFor="sap-post" hint={t('sap.postingDateHint')}>
              <Input id="sap-post" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} data-testid="input-sap-posting-date" />
            </Field>
            <Field label={t('sap.sender')} htmlFor="sap-sender" hint={t('sap.senderHint')}>
              <div className="flex gap-2">
                <Input
                  id="sap-sender"
                  inputMode="numeric"
                  maxLength={8}
                  value={sender}
                  onChange={(e) => setSender(e.target.value.replace(/\D/g, ''))}
                  aria-invalid={sender !== '' && !senderValid}
                  data-testid="input-sap-sender"
                />
                <Button variant="outline" onClick={onSaveSender} disabled={!senderValid || !senderDirty} loading={saveSettings.isPending} data-testid="btn-save-sap-sender">
                  {t('common.save')}
                </Button>
              </div>
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label={t('sap.text')} htmlFor="sap-text" hint={t('sap.textHint')} className="md:col-span-2">
              <Input id="sap-text" maxLength={50} value={text} onChange={(e) => setText(e.target.value)} data-testid="input-sap-text" />
            </Field>
            <Field label={t('sap.rowsPer')} htmlFor="sap-rows">
              <SimpleSelect id="sap-rows" value="recipient-provider" onValueChange={() => undefined} options={[{ value: 'recipient-provider', label: t('sap.rowsPerValue') }]} disabled />
            </Field>
            <Field label={t('sap.zeroAmounts')} htmlFor="sap-zero">
              <SimpleSelect id="sap-zero" value="skip" onValueChange={() => undefined} options={[{ value: 'skip', label: t('sap.zeroSkip') }]} disabled />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>2 · {t('sap.preview')}</CardTitle>
            <CardDescription>{t('sap.previewHint')}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCopy} disabled={!p?.rows.length} data-testid="btn-copy-sap-preview">
              <Copy />
              {t('sap.copy')}
            </Button>
            <Button onClick={onDownload} disabled={!p?.rows.length || !senderValid} loading={create.isPending} data-testid="btn-download-sap-export">
              <Download />
              {t('sap.download')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!senderValid ? (
            <Banner variant="warning" testId="hint-sap-sender-missing">
              {t('errors.SAP_SENDER_MISSING')}
            </Banner>
          ) : null}
          {p?.missingRecipient.length ? (
            <Banner variant="warning" title={t('sap.missingTitle', { count: p.missingRecipient.length })} testId="hint-sap-missing-recipient">
              {p.missingRecipient.map((c) => `${fmtCostCenter(c.number)} ${c.name} (${fmtMoney(c.spend)})`).join(' · ')}
            </Banner>
          ) : null}
          <div className="overflow-x-auto rounded-md border">
            <Table data-testid="table-sap-preview">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Belegdatum</TableHead>
                  <TableHead>Buchungsdatum</TableHead>
                  <TableHead>KoSt alt</TableHead>
                  <TableHead>KoSt_neu</TableHead>
                  <TableHead>Auftrag_neu</TableHead>
                  <TableHead>Text</TableHead>
                  <TableHead className="text-right">{t('sap.amountColumn')}</TableHead>
                  <TableHead>{t('sap.portalCostCenter')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ) : !p?.rows.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground h-20 text-center">
                      {t('sap.noRows')}
                    </TableCell>
                  </TableRow>
                ) : (
                  p.rows.map((r) => (
                    <TableRow key={`${r.recipientCostCenter ?? r.recipientOrder}-${r.text}`} data-testid="row-sap-preview">
                      <TableCell className="font-mono text-xs">{r.documentDate}</TableCell>
                      <TableCell className="font-mono text-xs">{r.postingDate}</TableCell>
                      <TableCell className="font-mono text-xs">{r.senderCostCenter || '–'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.recipientCostCenter ?? '–'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.recipientOrder ?? '–'}</TableCell>
                      <TableCell>{r.text}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.amount.toFixed(2).replace('.', ',')}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline">{r.recipientOrder ? t('sap.recipientTypes.project') : t('sap.recipientTypes.cost_center')}</Badge>
                          <span className="text-muted-foreground text-xs">{r.costCenters.map((c) => c.name).join(', ')}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {p?.rows.length ? (
            <div className="text-muted-foreground text-right text-sm" data-testid="sap-preview-total">
              {t('sap.total', { rows: p.rows.length, total: fmtMoney(p.total) })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sap.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table data-testid="table-sap-history">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t('sap.month')}</TableHead>
                  <TableHead>{t('sap.created')}</TableHead>
                  <TableHead>{t('sap.by')}</TableHead>
                  <TableHead className="text-right">{t('sap.rows')}</TableHead>
                  <TableHead className="text-right">{t('sap.sum')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-right">{t('sap.file')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!history.data?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground h-16 text-center">
                      {t('sap.noHistory')}
                    </TableCell>
                  </TableRow>
                ) : (
                  history.data.map((e) => (
                    <TableRow key={e.id} data-testid="row-sap-export">
                      <TableCell>{monthLabel(e.month)}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(e.createdAt)}</TableCell>
                      <TableCell>{e.createdBy?.name ?? '–'}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.rowCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(e.total)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-success">
                          {t('sap.statusExported')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => downloadSapExport(e.id)} data-testid="btn-sap-export-csv">
                          CSV
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
