import { EdgeFunctionError } from '@/lib/edge-functions';
import { extractErrorMessage } from '@/lib/error-utils';

export interface AppError {
  message: string;
  code?: string;
  status?: number;
  isNetworkError: boolean;
  cause?: unknown;
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

const NETWORK_ERROR_PATTERNS = [
  'network request failed',
  'failed to fetch',
  'network error',
  'fetcherror',
  'timeout',
  'timed out',
  'econnrefused',
  'enotfound',
  'offline',
  'internet connection appears to be offline',
  'the internet connection appears to be offline',
  'network is unreachable',
];

export function isLikelyNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof EdgeFunctionError) {
    // HTTP 4xx/5xx from Edge Function means server responded, except explicit 0/undefined network message
    if (typeof err.status === 'number' && err.status >= 400) {
      return false;
    }
  }
  if (typeof err === 'object' && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.status === 'number' && rec.status >= 400) {
      return false;
    }
    if (typeof rec.code === 'string' && rec.code.startsWith('PGRST')) {
      return false;
    }
  }
  const msg = extractErrorMessage(err, '').toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

export function normalizeAppError(
  err: unknown,
  fallbackMessage = 'An unexpected error occurred.'
): AppError {
  const message = extractErrorMessage(err, fallbackMessage);
  const record =
    typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : undefined;

  const code =
    err instanceof EdgeFunctionError
      ? err.code
      : typeof record?.code === 'string'
      ? record.code
      : undefined;

  const status =
    err instanceof EdgeFunctionError
      ? err.status
      : typeof record?.status === 'number'
      ? record.status
      : undefined;

  return {
    message,
    code,
    status,
    isNetworkError: isLikelyNetworkError(err),
    cause: err,
  };
}

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  err: unknown,
  fallbackMessage = 'An unexpected error occurred.'
): ServiceResult<T> {
  return {
    ok: false,
    error: normalizeAppError(err, fallbackMessage),
  };
}

