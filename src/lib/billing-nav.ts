import type { BillingMode } from '@/services/billing.service';

type BillingModeListener = (mode: BillingMode) => void;

let pendingBillingMode: BillingMode | null = null;
const listeners = new Set<BillingModeListener>();

export function requestBillingMode(mode: BillingMode): void {
  pendingBillingMode = mode;
  for (const listener of listeners) {
    listener(mode);
  }
}

export function consumePendingBillingMode(): BillingMode | null {
  const mode = pendingBillingMode;
  pendingBillingMode = null;
  return mode;
}

export function subscribeBillingModeRequests(
  listener: BillingModeListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
