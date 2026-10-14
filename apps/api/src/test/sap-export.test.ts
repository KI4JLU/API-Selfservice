import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SapExportPreviewSchema, SapExportSchema } from '@api-selfservice/shared';
import { costCenters, eq, requestLogs } from '@api-selfservice/db';
import { encodeCp1252, providerLabel, sapCsv, sapExportFile } from '../services/sap-export.js';
import { addMember, createTestApp, expectError, expectShape, litellmOwner, randomCostCenter, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('SAP export (#14)', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;
  const month = '2026-08';
  let ccA: { id: string; number: string };
  let ccB: { id: string; number: string };
  let ccSameAsA: { id: string; number: string };
  let ccMissing: { id: string; number: string };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    user = await t.login();
    const mk = async (sapRecipient: { type: 'cost_center' | 'project'; number: string }) => {
      const number = randomCostCenter();
      const owner = await litellmOwner(t, `sap-${number}@x.de`);
      const r = await admin.post('/admin/cost-centers', { number, name: `CC ${number}`, ownerUserId: owner.userId, sapRecipient });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await addMember(admin, r.body.id, user);
      return { id: r.body.id as string, number };
    };
    ccA = await mk({ type: 'cost_center', number: '11223344' });
    ccB = await mk({ type: 'project', number: '88997766' });
    ccSameAsA = await mk({ type: 'cost_center', number: '11223344' });
    ccMissing = await mk({ type: 'cost_center', number: '22334455' });
    // older cost centers have no SAP recipient yet
    await t.db.update(costCenters).set({ sapRecipientType: null, sapRecipientNumber: null }).where(eq(costCenters.id, ccMissing.id));

    const key = async (cc: { id: string }, models: string[]) => (await user.post('/api-keys', { name: `k-${cc.id}`, models, costCenterId: cc.id })).body.id as string;
    const kA = await key(ccA, ['gpt-4o', 'claude-sonnet-5']);
    const kB = await key(ccB, ['gpt-4o']);
    const kSame = await key(ccSameAsA, ['gpt-4o']);
    const kMissing = await key(ccMissing, ['gpt-4o']);
    const at = (d: number) => `2026-08-${String(d).padStart(2, '0')}T10:00:00.000Z`;
    await t.storeLogs([
      await t.addLog(kA, { spend: 100, startTime: at(3), model: 'gpt-4o' }),
      await t.addLog(kA, { spend: 15.5, startTime: at(4), model: 'claude-sonnet-5' }),
      await t.addLog(kSame, { spend: 20, startTime: at(5), model: 'gpt-4o' }),
      await t.addLog(kB, { spend: 20, startTime: at(6), model: 'gpt-4o' }),
      // rounds to 0,00 EUR and is left out
      await t.addLog(kB, { spend: 0.001, startTime: at(7), model: 'claude-sonnet-5' }),
      await t.addLog(kMissing, { spend: 9, startTime: at(8), model: 'gpt-4o' }),
      // other months do not count
      await t.addLog(kA, { spend: 999, startTime: '2026-09-01T00:00:00.000Z', model: 'gpt-4o' }),
    ]);
    // spend without a portal cost center (e.g. a key created outside the portal)
    await t.db.insert(requestLogs).values({ requestId: 'sap-unassigned-1', time: new Date('2026-08-09T10:00:00Z'), status: 'success', model: 'gpt-4o', provider: 'openai', cost: '3.25' });
  });
  afterAll(() => t.close());

  it('cost centers need a valid SAP recipient: cost center 1/2..., project 6/8...', async () => {
    const owner = await litellmOwner(t, 'sap-validation@x.de');
    const base = { number: randomCostCenter(), name: 'X', ownerUserId: owner.userId };
    expectError(await admin.post('/admin/cost-centers', base), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/admin/cost-centers', { ...base, sapRecipient: { type: 'cost_center', number: '61234567' } }), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/admin/cost-centers', { ...base, sapRecipient: { type: 'project', number: '11234567' } }), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/admin/cost-centers', { ...base, sapRecipient: { type: 'project', number: '8123456' } }), 400, 'VALIDATION_ERROR');
    const ok = await admin.post('/admin/cost-centers', { ...base, sapRecipient: { type: 'project', number: '61234567' } });
    expect(ok.status).toBe(201);
    expect(ok.body.sapRecipient).toEqual({ type: 'project', number: '61234567' });
    // an admin editing a cost center without recipient has to set it; budget changes by cost center admins still work
    expectError(await admin.patch(`/cost-centers/${ccMissing.id}`, { name: 'renamed' }), 409, 'SAP_RECIPIENT_REQUIRED');
    expect((await admin.patch(`/cost-centers/${ccMissing.id}`, { maxBudget: 50 })).status).toBe(200);
  });

  it('preview: one row per recipient and provider, last day of the month, zero rows left out, missing recipients listed', async () => {
    const r = await admin.post('/admin/sap-export/preview', { month });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = expectShape(SapExportPreviewSchema, r.body);
    expect(p).toMatchObject({ month, documentDate: '2026-08-31', postingDate: '2026-08-31', senderCostCenter: null, text: 'API-Kosten: {Provider}', total: 155.5 });
    expect(p.rows.map((x) => [x.recipientCostCenter, x.recipientOrder, x.text, x.amount, x.documentDate])).toEqual([
      ['11223344', null, 'API-Kosten: Anthropic', 15.5, '31082026'],
      ['11223344', null, 'API-Kosten: OpenAI', 120, '31082026'],
      [null, '88997766', 'API-Kosten: OpenAI', 20, '31082026'],
    ]);
    // two portal cost centers share the recipient 11223344
    expect(p.rows[1]!.costCenters.map((c) => c.id).sort()).toEqual([ccA.id, ccSameAsA.id].sort());
    expect(p.missingRecipient).toEqual([{ id: ccMissing.id, number: ccMissing.number, name: `CC ${ccMissing.number}`, spend: 9 }]);
    // spend without cost center is reported, not dropped silently
    expect(p.unassignedSpend).toBe(3.25);
    // own dates and text
    const custom = expectShape(SapExportPreviewSchema, (await admin.post('/admin/sap-export/preview', { month, documentDate: '2026-08-22', postingDate: '2026-08-30', text: 'KI {Provider}' })).body);
    expect(custom.rows[0]).toMatchObject({ documentDate: '22082026', postingDate: '30082026', text: 'KI Anthropic' });
    // the SAP text field has 50 characters; checked after {Provider} is replaced
    await t.db.insert(requestLogs).values({ requestId: 'sap-bedrock-1', costCenterId: ccA.id, time: new Date('2026-07-09T10:00:00Z'), status: 'success', model: 'x', provider: 'bedrock', cost: '1' });
    const long = `${'x'.repeat(39)} {Provider}`;
    expect(long.length).toBe(50);
    // "AWS Bedrock" is longer than "{Provider}"
    expectError(await admin.post('/admin/sap-export/preview', { month: '2026-07', text: long }), 400, 'VALIDATION_ERROR');
    expect((await admin.post('/admin/sap-export/preview', { month: '2026-07' })).body.rows[0].text).toBe('API-Kosten: AWS Bedrock');
    // a text that spreadsheets would read as formula is refused (CSV injection)
    for (const text of ['=1+1 {Provider}', '+{Provider}', '-x', '@SUM(A1)']) expectError(await admin.post('/admin/sap-export/preview', { month, text }), 400, 'VALIDATION_ERROR');
  });

  it('the export needs the sender cost center; the CSV keeps the LSMW format and is offered again from the history', async () => {
    expectError(await admin.post('/admin/sap-exports', { month }), 409, 'SAP_SENDER_MISSING');
    expectError(await admin.put('/admin/sap-export/settings', { senderCostCenter: '1234' }), 400, 'VALIDATION_ERROR');
    expect((await admin.put('/admin/sap-export/settings', { senderCostCenter: '22334455' })).body).toEqual({ senderCostCenter: '22334455' });
    expect((await admin.get('/admin/sap-export/settings')).body).toEqual({ senderCostCenter: '22334455' });

    const created = await admin.post('/admin/sap-exports', { month, text: 'API-Kosten für {Provider}' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const e = expectShape(SapExportSchema, created.body);
    expect(e).toMatchObject({ month, rowCount: 3, total: 155.5, senderCostCenter: '22334455', createdBy: { id: admin.userId } });
    expect(expectShape(z.array(SapExportSchema), (await admin.get('/admin/sap-exports')).body)[0]!.id).toBe(e.id);

    const file = await admin.get(`/admin/sap-exports/${e.id}/csv`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('text/csv; charset=windows-1252');
    expect(file.headers.get('content-disposition')).toContain('sap-export-2026-08.csv');
    const { bytes } = await sapExportFile(t.deps, e.id);
    // "für" in Windows-1252: ü = 0xFC, single byte
    expect(bytes).toContain(0xfc);
    expect(new TextDecoder('windows-1252').decode(bytes)).toBe(
      [
        'Belegdatum;Buchungsdatum;KoSt alt;KoSt_neu;Auftrag_neu;Text;Leistungsart',
        '31082026;31082026;22334455;11223344;;API-Kosten für Anthropic;15,50',
        '31082026;31082026;22334455;11223344;;API-Kosten für OpenAI;120,00',
        '31082026;31082026;22334455;;88997766;API-Kosten für OpenAI;20,00',
        '',
      ].join('\r\n'),
    );
    expectError(await admin.get('/admin/sap-exports/nope/csv'), 404, 'NOT_FOUND');
  });

  it('admins only', async () => {
    expectError(await user.post('/admin/sap-export/preview', { month }), 403, 'FORBIDDEN');
    expectError(await user.get('/admin/sap-exports'), 403, 'FORBIDDEN');
    expectError(await user.put('/admin/sap-export/settings', { senderCostCenter: '22334455' }), 403, 'FORBIDDEN');
  });

  it('helpers: provider names, CSV quoting and Windows-1252', () => {
    expect([providerLabel('azure'), providerLabel('openai'), providerLabel('vertex_ai'), providerLabel(null), providerLabel('groq')]).toEqual(['Azure', 'OpenAI', 'Google', 'Sonstige', 'Groq']);
    const row = { documentDate: '01012026', postingDate: '01012026', senderCostCenter: '1', recipientCostCenter: '2', recipientOrder: null, text: 'a;b', amount: 1.5, provider: 'x', costCenters: [] };
    expect(sapCsv({ rows: [row] }).split('\r\n')[1]).toBe('01012026;01012026;1;2;;"a;b";1,50');
    expect([...encodeCp1252('€ „x“ ä ✓')]).toEqual([0x80, 0x20, 0x84, 0x78, 0x93, 0x20, 0xe4, 0x20, 0x3f]);
  });
});
