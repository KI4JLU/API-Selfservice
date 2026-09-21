import { z } from 'zod';

/** Result of POST /admin/jobs/ingest: LiteLLM spend logs fetched and newly inserted. */
export const JobIngestResultSchema = z.object({
  fetched: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
});
export type JobIngestResult = z.infer<typeof JobIngestResultSchema>;

/** Result of POST /admin/jobs/key-expiry: keys warned (14d/1d) and keys expired. */
export const JobKeyExpiryResultSchema = z.object({
  warned: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
});
export type JobKeyExpiryResult = z.infer<typeof JobKeyExpiryResultSchema>;
