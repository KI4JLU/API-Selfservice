import i18n from './i18n';
import { isApiError } from './api';

export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    const key = `errors.${e.code}`;
    return i18n.exists(key) ? i18n.t(key) : e.message || e.code;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
