import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AdminUserSchema,
  ApiKeySchema,
  AuditEventSchema,
  CostCenterReportDetailSchema,
  CostCenterReportRowSchema,
  CostCenterRequestSchema,
  CostCenterSchema,
  CreatedApiKeySchema,
  LitellmUserSchema,
  MeSchema,
  NotificationSchema,
  ProviderSchema,
  ProviderSyncResult,
  RequestLogSchema,
  SpendSummarySchema,
  paginated,
  type AdminCreateCostCenterSchema,
  type CreateApiKeySchema,
  type SetBudgetSchema,
  type UpdateCostCenterSchema,
  type UpdateMeSchema,
  type UpdateProviderSchema,
} from '@api-selfservice/shared';
import { api } from './api';

export type Me = z.infer<typeof MeSchema>;
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type CreatedApiKey = z.infer<typeof CreatedApiKeySchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type CostCenter = z.infer<typeof CostCenterSchema>;
export type CostCenterRequest = z.infer<typeof CostCenterRequestSchema>;
export type SpendSummary = z.infer<typeof SpendSummarySchema>;
export type RequestLog = z.infer<typeof RequestLogSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type LitellmUser = z.infer<typeof LitellmUserSchema>;
export type ReportRow = z.infer<typeof CostCenterReportRowSchema>;
export type ReportDetail = z.infer<typeof CostCenterReportDetailSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

const PagedKeys = paginated(ApiKeySchema);
const PagedCostCenters = paginated(CostCenterSchema);
const PagedRequests = paginated(CostCenterRequestSchema);
const PagedLogs = paginated(RequestLogSchema);
const PagedUsers = paginated(AdminUserSchema);
const PagedLitellmUsers = paginated(LitellmUserSchema);
const PagedNotifications = paginated(NotificationSchema);
const OkResponse = z.object({ ok: z.literal(true) }).or(z.any());

export const qk = {
  me: ['me'] as const,
  spend: (month: string) => ['me', 'spend', month] as const,
  logs: (params: Record<string, unknown>) => ['me', 'logs', params] as const,
  keys: ['keys'] as const,
  providers: (costCenterId?: string) => ['providers', costCenterId ?? ''] as const,
  adminProviders: ['admin', 'providers'] as const,
  costCenters: (params: Record<string, unknown>) => ['cost-centers', params] as const,
  managedCostCenters: ['cost-centers', 'managed'] as const,
  costCenterRequests: (params: Record<string, unknown>) => ['cost-center-requests', params] as const,
  adminUsers: (params: Record<string, unknown>) => ['admin', 'users', params] as const,
  litellmUsers: (params: Record<string, unknown>) => ['admin', 'litellm-users', params] as const,
  reports: (params: Record<string, unknown>) => ['reports', params] as const,
  reportDetail: (id: string, params: Record<string, unknown>) => ['reports', id, params] as const,
  notifications: (params: Record<string, unknown>) => ['admin', 'notifications', params] as const,
  events: (params: Record<string, unknown>) => ['admin', 'events', params] as const,
};

export const meQuery = queryOptions({
  queryKey: qk.me,
  queryFn: () => api.get('/me', MeSchema),
  staleTime: 60_000,
  retry: false,
  meta: { silent: true },
});

export function useMe() {
  return useQuery(meQuery);
}

export function useSpend(month: string) {
  return useQuery({ queryKey: qk.spend(month), queryFn: () => api.get('/me/spend', SpendSummarySchema, { month }) });
}

export type LogsParams = {
  from?: string;
  to?: string;
  model?: string;
  keyId?: string;
  status?: 'success' | 'failure';
  requestId?: string;
  page: number;
  pageSize: number;
};

export function useLogs(params: LogsParams) {
  return useQuery({ queryKey: qk.logs(params), queryFn: () => api.get('/me/logs', PagedLogs, params), placeholderData: (prev) => prev });
}

export function useKeys() {
  return useQuery({ queryKey: qk.keys, queryFn: () => api.get('/api-keys', PagedKeys) });
}

export function useProviders(costCenterId?: string) {
  return useQuery({ queryKey: qk.providers(costCenterId), queryFn: () => api.get('/providers', z.array(ProviderSchema), { costCenterId }) });
}

export function useAdminProviders() {
  return useQuery({ queryKey: qk.adminProviders, queryFn: () => api.get('/admin/providers', z.array(ProviderSchema)) });
}

export type CostCentersParams = { status?: string; q?: string; page?: number; pageSize?: number };

export function useCostCenters(params: CostCentersParams, enabled = true) {
  return useQuery({
    queryKey: qk.costCenters(params),
    queryFn: () => api.get('/cost-centers', PagedCostCenters, params),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useManagedCostCenters() {
  return useQuery({ queryKey: qk.managedCostCenters, queryFn: () => api.get('/cost-centers/managed', PagedCostCenters, { pageSize: 200 }) });
}

export function useCostCenterRequests(params: { status?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: qk.costCenterRequests(params),
    queryFn: () => api.get('/cost-center-requests', PagedRequests, params),
    placeholderData: (prev) => prev,
  });
}

export type AdminUsersParams = { q?: string; costCenterId?: string; includeDeactivated?: boolean; page: number; pageSize: number };

export function useAdminUsers(params: AdminUsersParams) {
  return useQuery({ queryKey: qk.adminUsers(params), queryFn: () => api.get('/admin/users', PagedUsers, params), placeholderData: (prev) => prev });
}

export function useReports(params: { from?: string; to?: string }) {
  return useQuery({ queryKey: qk.reports(params), queryFn: () => api.get('/reports/cost-centers', z.array(CostCenterReportRowSchema), params) });
}

export function useReportDetail(id: string | null, params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: qk.reportDetail(id ?? '', params),
    queryFn: () => api.get(`/reports/cost-centers/${id}`, CostCenterReportDetailSchema, params),
    enabled: !!id,
  });
}

export function useNotifications(params: { type?: string; status?: string; page: number; pageSize: number }) {
  return useQuery({
    queryKey: qk.notifications(params),
    queryFn: () => api.get('/admin/notifications', PagedNotifications, params),
    placeholderData: (prev) => prev,
  });
}

const PagedEvents = paginated(AuditEventSchema);
export function useEvents(params: { severity?: string; entity?: string; action?: string; page: number; pageSize: number }) {
  return useQuery({
    queryKey: qk.events(params),
    queryFn: () => api.get('/admin/events', PagedEvents, params),
    placeholderData: (prev) => prev,
  });
}

/* ---------- mutations ---------- */

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k as unknown[] })));
}

export function useUpdateMe() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: z.infer<typeof UpdateMeSchema>) => api.patch('/me', body, MeSchema),
    onSuccess: () => inv(qk.me),
  });
}

export function useCreateKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: z.infer<typeof CreateApiKeySchema>) => api.post('/api-keys', body, CreatedApiKeySchema),
    onSuccess: () => inv(qk.keys, qk.me),
  });
}

export function useExtendKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api-keys/${id}/extend`, {}, ApiKeySchema),
    onSuccess: () => inv(qk.keys),
  });
}

export function useDeleteKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`, OkResponse),
    onSuccess: () => inv(qk.keys),
  });
}

export function useUpdateCostCenter() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: z.infer<typeof UpdateCostCenterSchema> }) => api.patch(`/cost-centers/${id}`, body, CostCenterSchema),
    onSuccess: () => inv(['cost-centers'], ['reports']),
  });
}

export function useCreateCostCenter() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: z.infer<typeof AdminCreateCostCenterSchema>) => api.post('/admin/cost-centers', body, CostCenterSchema),
    onSuccess: () => inv(['cost-centers']),
  });
}

export function useArchiveCostCenter() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.post(`/admin/cost-centers/${id}/archive`, {}, OkResponse),
    onSuccess: () => inv(['cost-centers']),
  });
}

export function useApproveRequest() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.post(`/cost-center-requests/${id}/approve`, {}, OkResponse),
    onSuccess: () => inv(['cost-center-requests'], ['cost-centers'], ['admin']),
  });
}

export function useRejectRequest() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/cost-center-requests/${id}/reject`, { reason }, OkResponse),
    onSuccess: () => inv(['cost-center-requests'], ['cost-centers']),
  });
}

export function useUpdateProvider() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: z.infer<typeof UpdateProviderSchema> }) => api.patch(`/admin/providers/${id}`, body, ProviderSchema),
    onSuccess: () => inv(['providers'], qk.adminProviders),
  });
}

export function useSyncProviders() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api.post('/admin/providers/sync', {}, ProviderSyncResult),
    onSuccess: () => inv(['providers'], qk.adminProviders),
  });
}

export function useSetRole() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'user' | 'admin' }) => api.patch(`/admin/users/${id}/role`, { role }, AdminUserSchema),
    onSuccess: () => inv(['admin', 'users']),
  });
}

export function useSetCostCenterAdmin() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, costCenterIds }: { id: string; costCenterIds: string[] }) => api.put(`/admin/users/${id}/cost-center-admin`, { costCenterIds }, AdminUserSchema),
    onSuccess: () => inv(['admin', 'users']),
  });
}

export function useSetBudget() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: z.infer<typeof SetBudgetSchema> }) => api.put(`/admin/users/${id}/budget`, body, OkResponse),
    onSuccess: () => inv(['admin', 'users'], ['me']),
  });
}

export function useDeactivateUser() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/deactivate`, {}, OkResponse),
    onSuccess: () => inv(['admin', 'users']),
  });
}

export function useLitellmUsers(params: { q?: string; page?: number; pageSize?: number }) {
  return useQuery({ queryKey: qk.litellmUsers(params), queryFn: () => api.get('/admin/litellm-users', PagedLitellmUsers, params), retry: false });
}

export function useImpersonate() {
  return useMutation({ mutationFn: (id: string) => api.post(`/admin/users/${id}/impersonate`, {}, OkResponse) });
}

export function useStopImpersonation() {
  return useMutation({ mutationFn: () => api.delete('/me/impersonation', OkResponse) });
}

export function useReactivateUser() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/reactivate`, {}, OkResponse),
    onSuccess: () => inv(['admin', 'users']),
  });
}
