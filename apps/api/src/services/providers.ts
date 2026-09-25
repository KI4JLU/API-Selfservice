import { costCenters, eq, providers } from '@api-selfservice/db';
import type { ProviderTier } from '@api-selfservice/shared';
import type { CurrentUser, Deps } from '../context.js';
import { notFound } from '../errors.js';
import { audit } from './audit.js';

type CC = typeof costCenters.$inferSelect;
type P = typeof providers.$inferSelect;

export function providerView(p: P) {
  return {
    id: p.id,
    modelName: p.modelName,
    litellmModelId: p.litellmModelId,
    provider: p.provider,
    tier: p.tier,
    displayNameDe: p.displayNameDe,
    displayNameEn: p.displayNameEn,
    descriptionDe: p.descriptionDe,
    descriptionEn: p.descriptionEn,
    inputCostPerToken: p.inputCostPerToken === null ? null : Number(p.inputCostPerToken),
    outputCostPerToken: p.outputCostPerToken === null ? null : Number(p.outputCostPerToken),
    available: p.available,
    lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
  };
}

/** F-PRV-3: free models always; paid models only for non-default approved cost centers. */
export async function allowedModelsForCostCenter(deps: Deps, cc: CC): Promise<P[]> {
  const all = await deps.db.query.providers.findMany({ where: eq(providers.available, true), orderBy: [providers.modelName] });
  if (cc.isDefault || cc.status !== 'approved') return all.filter((p) => p.tier === 'free');
  return all;
}

export async function listProvidersForUser(deps: Deps, cu: CurrentUser, costCenterId?: string) {
  const ccId = costCenterId ?? cu.costCenterId;
  const cc = ccId ? await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, ccId) }) : null;
  const { getDefaultCostCenter } = await import('./cost-centers.js');
  const rows = await allowedModelsForCostCenter(deps, cc ?? (await getDefaultCostCenter(deps)));
  return rows.map(providerView);
}

export async function adminListProviders(deps: Deps) {
  const rows = await deps.db.query.providers.findMany({ orderBy: [providers.modelName] });
  return rows.map(providerView);
}

export async function updateProvider(
  deps: Deps,
  actor: CurrentUser,
  id: string,
  input: { tier?: ProviderTier; displayNameDe?: string | null; displayNameEn?: string | null; descriptionDe?: string | null; descriptionEn?: string | null },
) {
  const p = await deps.db.query.providers.findFirst({ where: eq(providers.id, id) });
  if (!p) throw notFound('Provider');
  const [row] = await deps.db.update(providers).set({ ...input, updatedAt: deps.now() }).where(eq(providers.id, id)).returning();
  await audit(deps, { actorId: actor.id, action: 'provider.update', entity: 'provider', entityId: id, payload: input });
  return providerView(row!);
}

/** F-PRV-2: new models arrive as `paid` until an admin changes them. */
export async function syncProviders(deps: Deps, actorId: string | null) {
  const models = await deps.litellm.listModels();
  const existing = await deps.db.query.providers.findMany();
  const byName = new Map(existing.map((p) => [p.modelName, p]));
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const m of models) {
    seen.add(m.modelName);
    const p = byName.get(m.modelName);
    const prices = {
      inputCostPerToken: m.inputCostPerToken === null ? null : String(m.inputCostPerToken),
      outputCostPerToken: m.outputCostPerToken === null ? null : String(m.outputCostPerToken),
    };
    if (!p) {
      await deps.db.insert(providers).values({ modelName: m.modelName, litellmModelId: m.modelId, provider: m.provider, tier: 'paid', available: true, lastSeenAt: deps.now(), ...prices });
      added++;
    } else {
      await deps.db
        .update(providers)
        .set({ litellmModelId: m.modelId, provider: m.provider ?? p.provider, available: true, lastSeenAt: deps.now(), updatedAt: deps.now(), ...prices })
        .where(eq(providers.id, p.id));
      updated++;
    }
  }
  let unavailable = 0;
  for (const p of existing) {
    if (!seen.has(p.modelName) && p.available) {
      await deps.db.update(providers).set({ available: false, updatedAt: deps.now() }).where(eq(providers.id, p.id));
      unavailable++;
    }
  }
  await audit(deps, { actorId, action: 'provider.sync', entity: 'provider', payload: { added, updated, unavailable } });
  return { added, updated, unavailable };
}
