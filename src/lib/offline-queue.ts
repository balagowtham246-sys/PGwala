import { isLikelyNetworkError, normalizeAppError } from '@/lib/service-result';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_QUEUE_STORAGE_KEY = '@pgwala_offline_queue_v1';
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Explicit allowlist of non-financial resident mutations permitted in the offline queue.
 * Financial, billing, resident onboarding, warden, menu, and washing-machine writes
 * are intentionally excluded and must stay strictly online.
 */
export const APPROVED_OFFLINE_OPERATIONS = [
  'gate_movement_log',
  'food_opt_in',
  'complaint_submit',
] as const;

export type ApprovedOfflineOperation = (typeof APPROVED_OFFLINE_OPERATIONS)[number];

export interface OfflineQueueItem<TPayload = Record<string, unknown>> {
  id: string;
  operation: ApprovedOfflineOperation;
  payload: TPayload;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastError?: string;
}

export type OfflineExecutorMap = Partial<{
  [K in ApprovedOfflineOperation]: (payload: Record<string, unknown>) => Promise<void>;
}>;

export interface FlushQueueSummary {
  succeeded: number;
  failedPermanent: number;
  retainedForRetry: number;
  remainingCount: number;
}

type QueueListener = (pendingCount: number) => void;
const queueListeners = new Set<QueueListener>();

let flushInFlight: Promise<FlushQueueSummary> | null = null;

export function isApprovedOfflineOperation(op: string): op is ApprovedOfflineOperation {
  return (APPROVED_OFFLINE_OPERATIONS as readonly string[]).includes(op);
}

function assertApprovedOperation(op: string): asserts op is ApprovedOfflineOperation {
  if (!isApprovedOfflineOperation(op)) {
    throw new Error(
      `Operation "${op}" is not approved for offline queuing. Only [${APPROVED_OFFLINE_OPERATIONS.join(', ')}] are permitted offline.`
    );
  }
}

async function readQueue(): Promise<OfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OfflineQueueItem =>
        Boolean(item) &&
        typeof item.operation === 'string' &&
        isApprovedOfflineOperation(item.operation) &&
        typeof item.idempotencyKey === 'string'
    );
  } catch {
    return [];
  }
}

async function writeQueue(items: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(items));
  for (const listener of queueListeners) {
    listener(items.length);
  }
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  return readQueue();
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

export function subscribeOfflineQueue(listener: QueueListener): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

export async function enqueueOfflineMutation<TPayload extends Record<string, unknown>>(
  operation: ApprovedOfflineOperation | string,
  payload: TPayload,
  idempotencyKey: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS
): Promise<OfflineQueueItem<TPayload>> {
  assertApprovedOperation(operation);
  const cleanKey = idempotencyKey.trim();
  if (!cleanKey) {
    throw new Error('idempotencyKey is required for offline mutations.');
  }

  const queue = await readQueue();
  const existing = queue.find(
    (item) => item.operation === operation && item.idempotencyKey === cleanKey
  );
  if (existing) {
    return existing as OfflineQueueItem<TPayload>;
  }

  const item: OfflineQueueItem<TPayload> = {
    id: `${operation}:${cleanKey}`,
    operation,
    payload,
    idempotencyKey: cleanKey,
    attempts: 0,
    maxAttempts: Math.max(1, maxAttempts),
    createdAt: Date.now(),
  };

  queue.push(item as OfflineQueueItem);
  await writeQueue(queue);
  return item;
}

export async function flushOfflineQueue(
  executors: OfflineExecutorMap
): Promise<FlushQueueSummary> {
  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async () => {
    const queue = await readQueue();
    if (queue.length === 0) {
      return {
        succeeded: 0,
        failedPermanent: 0,
        retainedForRetry: 0,
        remainingCount: 0,
      };
    }

    let succeeded = 0;
    let failedPermanent = 0;
    const nextQueue: OfflineQueueItem[] = [];

    for (const item of queue) {
      const executor = executors[item.operation];
      if (!executor) {
        nextQueue.push(item);
        continue;
      }

      try {
        await executor(item.payload);
        succeeded += 1;
      } catch (err) {
        const normalized = normalizeAppError(err);
        const nextAttempts = item.attempts + 1;
        const canRetry =
          isLikelyNetworkError(err) && nextAttempts < item.maxAttempts;

        if (canRetry) {
          nextQueue.push({
            ...item,
            attempts: nextAttempts,
            lastError: normalized.message,
          });
        } else {
          failedPermanent += 1;
        }
      }
    }

    await writeQueue(nextQueue);
    return {
      succeeded,
      failedPermanent,
      retainedForRetry: nextQueue.length,
      remainingCount: nextQueue.length,
    };
  })();

  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export async function clearOfflineQueue(): Promise<void> {
  await writeQueue([]);
}

