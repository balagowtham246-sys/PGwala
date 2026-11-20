/**
 * Food Alerts: shared types and pure helpers (no React / Supabase imports so they are unit-testable).
 */

import { formatHhMmTo12h, normalizeTimeMeridiemLowercase } from './ux-utils';

export type FoodMealType = 'breakfast' | 'lunch' | 'dinner';
export type FoodAlertStatus = 'ready' | 'delayed' | 'cancelled';
export type FoodAudienceType = 'all' | 'rooms' | 'residents';
export type FoodDispatchStatus = 'pending' | 'sent' | 'partial' | 'failed' | 'no_push';

export const MEAL_OPTIONS: { key: FoodMealType; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
];

export const STATUS_OPTIONS: { key: FoodAlertStatus; label: string }[] = [
  { key: 'ready', label: 'Ready' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export const MAX_ALERT_MESSAGE_LENGTH = 200;

export interface FoodAlertRecord {
  id: string;
  property_id: string;
  meal_type: FoodMealType;
  status: FoodAlertStatus;
  message: string | null;
  audience_type: FoodAudienceType;
  dispatch_status: FoodDispatchStatus;
  recipients_count: number;
  push_sent: number;
  push_failed: number;
  no_token_count: number;
  alert_date: string;
  created_at: string;
}

export interface AudienceResident {
  resident_id: string;
  full_name: string;
  room_number: string;
}

export function mealLabel(meal: FoodMealType): string {
  return MEAL_OPTIONS.find((m) => m.key === meal)?.label ?? meal;
}

export function statusLabel(status: FoodAlertStatus): string {
  return STATUS_OPTIONS.find((s) => s.key === status)?.label ?? status;
}

/** One-line headline for an alert, e.g. "Dinner is delayed". */
export function alertHeadline(meal: FoodMealType, status: FoodAlertStatus): string {
  const verb = status === 'ready' ? 'is ready' : status === 'delayed' ? 'is delayed' : 'is cancelled';
  return `${mealLabel(meal)} ${verb}`;
}

/** Unique-enough request key for server-side duplicate protection. */
export function createIdempotencyKey(now: number = Date.now(), random: number = Math.random()): string {
  return `fa-${now.toString(36)}-${Math.floor(random * 0xffffff).toString(36).padStart(5, '0')}`;
}

export interface AlertFormInput {
  meal: FoodMealType | null;
  status: FoodAlertStatus | null;
  audience: FoodAudienceType;
  rooms: string[];
  residentIds: string[];
  message: string;
}

/** Returns an error message, or null when the form is valid. */
export function validateAlertForm(input: AlertFormInput): string | null {
  if (!input.meal) return 'Select a meal.';
  if (!input.status) return 'Select a food status.';
  if (input.message.trim().length > MAX_ALERT_MESSAGE_LENGTH) {
    return `Message must be ${MAX_ALERT_MESSAGE_LENGTH} characters or fewer.`;
  }
  if (input.audience === 'rooms' && input.rooms.length === 0) return 'Select at least one room.';
  if (input.audience === 'residents' && input.residentIds.length === 0) {
    return 'Select at least one resident.';
  }
  return null;
}

/** Distinct, naturally sorted room numbers from the audience list. */
export function uniqueRooms(residents: AudienceResident[]): string[] {
  const set = new Set(residents.map((r) => r.room_number));
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Preview of how many residents a selection will reach (server re-validates). */
export function countTargeted(
  residents: AudienceResident[],
  audience: FoodAudienceType,
  rooms: string[],
  residentIds: string[]
): number {
  if (audience === 'all') return residents.length;
  if (audience === 'rooms') {
    const set = new Set(rooms);
    return residents.filter((r) => set.has(r.room_number)).length;
  }
  const set = new Set(residentIds);
  return residents.filter((r) => set.has(r.resident_id)).length;
}

/** Latest alert per meal for the given IST date string (YYYY-MM-DD). */
export function latestAlertPerMeal<
  T extends Pick<FoodAlertRecord, 'alert_date' | 'meal_type' | 'created_at'>,
>(alerts: T[], dateIso: string): Partial<Record<FoodMealType, T>> {
  const out: Partial<Record<FoodMealType, T>> = {};
  for (const a of alerts) {
    if (a.alert_date !== dateIso) continue;
    const prev = out[a.meal_type];
    if (!prev || new Date(a.created_at).getTime() > new Date(prev.created_at).getTime()) {
      out[a.meal_type] = a;
    }
  }
  return out;
}

/** Today's date in IST as YYYY-MM-DD (matches food_alerts.alert_date default). */
export function istDateIso(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export interface AlertSendSummary {
  targeted: number;
  push_sent: number;
  push_failed: number;
  in_app_only: number;
  dispatch_status: FoodDispatchStatus;
  duplicate?: boolean;
}

/** Human summary shown to the warden after sending. */
export function describeSendResult(s: AlertSendSummary): { title: string; detail: string } {
  const title = s.duplicate
    ? 'Already sent'
    : `Alert sent to ${s.targeted} resident${s.targeted === 1 ? '' : 's'}`;
  let detail: string;
  switch (s.dispatch_status) {
    case 'sent':
      detail = `Push delivered to ${s.push_sent}.` + (s.in_app_only ? ` ${s.in_app_only} will see it in the app.` : '');
      break;
    case 'partial':
      detail = `Push delivered to ${s.push_sent}, failed for ${s.push_failed}. All residents can see it in the app.`;
      break;
    case 'failed':
      detail = 'Push notification could not be delivered. Residents can still see it in the app.';
      break;
    case 'no_push':
      detail = 'No residents have notifications enabled. They will see it in the app.';
      break;
    default:
      detail = 'Notification is being processed.';
  }
  return { title, detail };
}

/** Relative-friendly timestamp like "Today, 8:05 pm" / "12 Nov, 8:05 pm". */
export function formatAlertTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = normalizeTimeMeridiemLowercase(
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  );
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `Today, ${time}`;
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${date}, ${time}`;
}

const MEAL_EXPIRY_CUTOFF_MINUTES: Record<FoodMealType, number> = {
  breakfast: 11 * 60 + 30, // 11:30 am
  lunch: 15 * 60 + 30, // 3:30 pm
  dinner: 23 * 60 + 30, // 11:30 pm
};

/**
 * Returns true once the meal window for a food alert has ended or when the alert
 * is from an earlier calendar day. Expired alerts should not count toward unread badges.
 */
export function isFoodAlertExpired(
  mealType: FoodMealType,
  createdAtIso: string,
  now: Date = new Date()
): boolean {
  const created = new Date(createdAtIso);
  if (Number.isNaN(created.getTime())) return true;

  const createdDay = new Date(
    created.getFullYear(),
    created.getMonth(),
    created.getDate()
  ).getTime();
  const currentDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  if (createdDay < currentDay) return true;
  if (createdDay > currentDay) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= MEAL_EXPIRY_CUTOFF_MINUTES[mealType];
}

/**
 * Formats specific body text for a food alert: custom message if present, else
 * "<Meal> is served/delayed/cancelled at <time>." when a meal_time exists, or
 * empty string so no generic placeholder text is shown.
 */
export function formatFoodAlertBody(
  mealType: FoodMealType,
  status: FoodAlertStatus,
  customMessage: string | null | undefined,
  mealTimeHhMm: string | null | undefined
): string {
  const cleanCustom = (customMessage || '').trim();
  if (cleanCustom) return cleanCustom;

  const timeLabel = formatHhMmTo12h(mealTimeHhMm);
  if (!timeLabel) return '';

  const verb = status === 'ready' ? 'is served' : `is ${status}`;
  return `${mealLabel(mealType)} ${verb} at ${timeLabel}.`;
}
