import {
  ApprovedOfflineOperation,
  enqueueOfflineMutation,
} from '@/lib/offline-queue';
import { invalidatePrefix } from '@/lib/query-cache';
import {
  AppError,
  isLikelyNetworkError,
  normalizeAppError,
} from '@/lib/service-result';
import { useCallback, useState } from 'react';

export interface UseOfflineMutationOptions<TPayload extends Record<string, unknown>, TResult> {
  operation: ApprovedOfflineOperation;
  execute: (payload: TPayload) => Promise<TResult>;
  invalidatePrefixes?: string[];
}

export type OfflineMutationOutcome<TResult> =
  | { ok: true; queued: false; data: TResult }
  | { ok: true; queued: true }
  | { ok: false; queued: false; error: AppError };

export function useOfflineMutation<TPayload extends Record<string, unknown>, TResult = void>({
  operation,
  execute,
  invalidatePrefixes = [],
}: UseOfflineMutationOptions<TPayload, TResult>) {
  const [isMutating, setIsMutating] = useState(false);

  const mutate = useCallback(
    async (
      payload: TPayload,
      idempotencyKey?: string
    ): Promise<OfflineMutationOutcome<TResult>> => {
      setIsMutating(true);
      try {
        const data = await execute(payload);
        await Promise.all(invalidatePrefixes.map((prefix) => invalidatePrefix(prefix)));
        return { ok: true, queued: false, data };
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          const key =
            idempotencyKey?.trim() ||
            `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await enqueueOfflineMutation(operation, payload, key);
          return { ok: true, queued: true };
        }
        return {
          ok: false,
          queued: false,
          error: normalizeAppError(err),
        };
      } finally {
        setIsMutating(false);
      }
    },
    [execute, invalidatePrefixes, operation]
  );

  return {
    mutate,
    isMutating,
  };
}

