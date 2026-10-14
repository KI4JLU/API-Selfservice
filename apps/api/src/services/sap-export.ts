import { and, appSettings, costCenters, desc, eq, gte, inArray, lt, requestLogs, sapExports, sum, user } from '@api-selfservice/db';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, notFound } from '../errors.js';
import { audit } from './audit.js';

// ---------- #14: SAP export of the API costs (CSV for the LSMW import, internal cost allocation) ----------

const SENDER_KEY = 'sap.sender_cost_center';
export const DEFAULT_SAP_TEXT = 'API-Kosten: {Provider}';
const HEADER = ['Belegdatum', 'Buchungsdatum', 'KoSt alt', 'KoSt_neu', 'Auftrag_neu', 'Text', 'Leistungsart'];
/** length of the SAP posting text field (SGTXT) */
const MAX_TEXT = 50;

const PROVIDER_LABELS: Record<string, string> = {
  azure: 'Azure',
  azure_ai: 'Azure',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google',
  vertex_ai: 'Google',
  google: 'Google',
  mistral: 'Mistral',
  hosted_vllm: 'vLLM',
  bedrock: 'AWS Bedrock',
};

/** Name of a LiteLLM provider in the posting text, e.g. `azure` -> "Azure". */
export function providerLabel(provider: string | null): string {
  if (!provider) return 'Sonstige';
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

export async function getSapSettings(deps: Deps) {
  const row = await deps.db.query.appSettings.findFirst({ where: eq(appSettings.key, SENDER_KEY) });
  const value = row?.value as { senderCostCenter?: unknown } | null | undefined;
  return { senderCostCenter: typeof value?.senderCostCenter === 'string' ? value.senderCostCenter : null };
}

export async function setSapSettings(deps: Deps, actor: CurrentUser, senderCostCenter: string) {
  await deps.db
    .insert(appSettings)
    .values({ key: SENDER_KEY, value: { senderCostCenter }, updatedBy: actor.id, updatedAt: deps.now() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { senderCostCenter }, updatedBy: actor.id, updatedAt: deps.now() } });
  await audit(deps, { actorId: actor.id, action: 'sap.settings', entity: 'sap_export', entityId: null, payload: { senderCostCenter } });
  return getSapSettings(deps);
}

function lastDayOf(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD -> TTMMJJJJ */
const sapDate = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}`;
const cents = (v: number) => Math.round(v * 100) / 100;

type Input = { month: string; documentDate?: string; postingDate?: string; text?: string };

/**
 * One row per SAP recipient and provider with the spend of the month (UTC). Exactly one of KoSt_neu (cost center)
 * and Auftrag_neu (project) is set. Rows that round to 0,00 EUR are left out. Cost centers with spend but no SAP
 * recipient are listed separately and not exported.
 */
export async function sapExportPreview(deps: Deps, input: Input) {
  const [y, m] = input.month.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const documentDate = input.documentDate ?? lastDayOf(input.month);
  const postingDate = input.postingDate ?? lastDayOf(input.month);
  const text = input.text ?? DEFAULT_SAP_TEXT;
  const { senderCostCenter } = await getSapSettings(deps);

  const spend = await deps.db
    .select({ costCenterId: requestLogs.costCenterId, provider: requestLogs.provider, s: sum(requestLogs.cost) })
    .from(requestLogs)
    .where(and(gte(requestLogs.time, start), lt(requestLogs.time, end)))
    .groupBy(requestLogs.costCenterId, requestLogs.provider);
  const ids = [...new Set(spend.map((r) => r.costCenterId).filter((x): x is string => !!x))];
  const ccs = ids.length ? await deps.db.query.costCenters.findMany({ where: inArray(costCenters.id, ids) }) : [];
  const ccById = new Map(ccs.map((c) => [c.id, c]));

  const groups = new Map<string, { type: 'cost_center' | 'project'; number: string; provider: string; amount: number; costCenters: Map<string, { id: string; number: string; name: string }> }>();
  const missing = new Map<string, { id: string; number: string; name: string; spend: number }>();
  // spend that belongs to no (existing) cost center cannot be charged; it is reported, not dropped silently
  let unassigned = 0;
  for (const r of spend) {
    const cc = r.costCenterId ? ccById.get(r.costCenterId) : undefined;
    const amount = Number(r.s ?? 0);
    if (amount <= 0) continue;
    if (!cc) {
      unassigned += amount;
      continue;
    }
    if (!cc.sapRecipientType || !cc.sapRecipientNumber) {
      const prev = missing.get(cc.id) ?? { id: cc.id, number: cc.number, name: cc.name, spend: 0 };
      missing.set(cc.id, { ...prev, spend: prev.spend + amount });
      continue;
    }
    const provider = providerLabel(r.provider);
    const key = `${cc.sapRecipientType}:${cc.sapRecipientNumber}:${provider}`;
    const g = groups.get(key) ?? { type: cc.sapRecipientType, number: cc.sapRecipientNumber, provider, amount: 0, costCenters: new Map() };
    g.amount += amount;
    g.costCenters.set(cc.id, { id: cc.id, number: cc.number, name: cc.name });
    groups.set(key, g);
  }

  const rows = [...groups.values()]
    .map((g) => ({
      documentDate: sapDate(documentDate),
      postingDate: sapDate(postingDate),
      senderCostCenter: senderCostCenter ?? '',
      recipientCostCenter: g.type === 'cost_center' ? g.number : null,
      recipientOrder: g.type === 'project' ? g.number : null,
      text: text.replaceAll('{Provider}', g.provider),
      amount: cents(g.amount),
      provider: g.provider,
      costCenters: [...g.costCenters.values()],
    }))
    .filter((r) => r.amount > 0)
    .map((r) => {
      if (r.text.length > MAX_TEXT) throw new ApiError('VALIDATION_ERROR', `Posting text "${r.text}" is longer than ${MAX_TEXT} characters`);
      return r;
    })
    .sort((a, b) => (a.recipientCostCenter ?? a.recipientOrder!).localeCompare(b.recipientCostCenter ?? b.recipientOrder!) || a.text.localeCompare(b.text));
  return {
    month: input.month,
    documentDate,
    postingDate,
    senderCostCenter,
    text,
    rows,
    total: cents(rows.reduce((a, r) => a + r.amount, 0)),
    missingRecipient: [...missing.values()].map((x) => ({ ...x, spend: cents(x.spend) })).sort((a, b) => b.spend - a.spend),
    unassignedSpend: cents(unassigned),
  };
}

type Preview = Awaited<ReturnType<typeof sapExportPreview>>;

/** CSV for LSMW: `;`, decimal comma, header row, CRLF (encoded as Windows-1252 on download). */
export function sapCsv(p: Pick<Preview, 'rows'>): string {
  const cell = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = p.rows.map((r) => [r.documentDate, r.postingDate, r.senderCostCenter, r.recipientCostCenter ?? '', r.recipientOrder ?? '', r.text, r.amount.toFixed(2).replace('.', ',')]);
  return [HEADER, ...lines].map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
}

// Windows-1252 bytes 0x80-0x9F that differ from Latin-1
const CP1252: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** Text as Windows-1252 bytes; characters outside it become `?`. */
export function encodeCp1252(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (CP1252[ch] !== undefined) out.push(CP1252[ch]);
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}

async function exportView(deps: Deps, rows: (typeof sapExports.$inferSelect)[]) {
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
  const users = ids.length ? await deps.db.query.user.findMany({ where: inArray(user.id, ids), columns: { id: true, name: true } }) : [];
  return rows.map((r) => ({
    id: r.id,
    month: r.month,
    documentDate: r.documentDate,
    postingDate: r.postingDate,
    senderCostCenter: r.senderCostCenter,
    rowCount: r.rowCount,
    total: Number(r.total),
    createdAt: r.createdAt.toISOString(),
    createdBy: users.find((u) => u.id === r.createdBy) ?? null,
  }));
}

/** Creates the export: computes the rows, stores the CSV for later downloads and logs it. */
export async function createSapExport(deps: Deps, actor: CurrentUser, input: Input) {
  const p = await sapExportPreview(deps, input);
  if (!p.senderCostCenter) throw new ApiError('SAP_SENDER_MISSING', 'Set the sender cost center first');
  const [row] = await deps.db
    .insert(sapExports)
    .values({
      month: p.month,
      documentDate: p.documentDate,
      postingDate: p.postingDate,
      senderCostCenter: p.senderCostCenter,
      rowCount: p.rows.length,
      total: String(p.total),
      csv: sapCsv(p),
      createdBy: actor.id,
      createdAt: deps.now(),
    })
    .returning();
  await audit(deps, { actorId: actor.id, action: 'sap.export', entity: 'sap_export', entityId: row!.id, payload: { month: p.month, rows: p.rows.length, total: p.total } });
  return (await exportView(deps, [row!]))[0]!;
}

export async function listSapExports(deps: Deps) {
  return exportView(deps, await deps.db.query.sapExports.findMany({ orderBy: [desc(sapExports.createdAt)], limit: 100 }));
}

export async function sapExportFile(deps: Deps, id: string) {
  const row = await deps.db.query.sapExports.findFirst({ where: eq(sapExports.id, id) });
  if (!row) throw notFound('SAP export');
  return { filename: `sap-export-${row.month}.csv`, bytes: encodeCp1252(row.csv) };
}
