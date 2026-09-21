import type { z } from 'zod';
import type { ErrorCode } from '@litelite/shared';

export class ApiError extends Error {
  code: ErrorCode | string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const BASE = '/api/v1';

async function request<T>(method: Method, path: string, schema?: z.ZodType<T>, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path.startsWith('/api/') ? path : `${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const err = (json ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(err.code ?? (res.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL'), err.message ?? res.statusText, res.status, err.details);
  }
  if (schema) return schema.parse(json);
  return json as T;
}

export const api = {
  get: <T>(path: string, schema?: z.ZodType<T>, query?: Query) => request<T>('GET', withQuery(path, query), schema),
  post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>('POST', path, schema, body ?? {}),
  put: <T>(path: string, body: unknown, schema?: z.ZodType<T>) => request<T>('PUT', path, schema, body),
  patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) => request<T>('PATCH', path, schema, body),
  delete: <T>(path: string, schema?: z.ZodType<T>) => request<T>('DELETE', path, schema),
};

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
