export type PropertyGenderType = 'coed' | 'girls' | 'boys';
export type ResidentGender = 'male' | 'female' | 'other';

const UPPERCASE_WORDS = new Set(['pg', 'eb', 'wm', 'ac', 'tv']);

/**
 * Normalizes a single dish string to clean Title Case while preserving separators
 * like `/` (e.g., "tea / coffee" -> "Tea / Coffee", "idli" -> "Idli").
 */
export function normalizeDishName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .map((token) => {
      if (token === '/' || token === '&' || token === '-') return token;
      return token
        .split('/')
        .map((sub) => {
          if (!sub) return sub;
          const lower = sub.toLowerCase();
          if (UPPERCASE_WORDS.has(lower)) return lower.toUpperCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('/');
    })
    .join(' ');
}

/**
 * Splits a comma/newline separated dish string into deduplicated normalized dish chips.
 */
export function parseDishList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of raw.split(/[,\n]+/)) {
    const normalized = normalizeDishName(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Serializes dish chips into canonical comma-separated string for storage.
 */
export function serializeDishList(dishes: string[]): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const dish of dishes) {
    const normalized = normalizeDishName(dish);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(normalized);
    }
  }
  return cleaned.join(', ');
}

export interface IndianPhoneValidation {
  valid: boolean;
  normalized10: string;
  formatted: string;
  error?: string;
}

/**
 * Validates and formats Indian 10-digit mobile numbers (+91 prefix supported).
 */
export function validateIndianPhone(raw: string | null | undefined): IndianPhoneValidation {
  const value = (raw || '').trim();
  if (!value) {
    return {
      valid: false,
      normalized10: '',
      formatted: '',
      error: 'Phone number is required (10 digits).',
    };
  }

  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10 || !/^\d{10}$/.test(digits)) {
    return {
      valid: false,
      normalized10: digits,
      formatted: digits,
      error: 'Enter a valid 10-digit mobile number.',
    };
  }

  return {
    valid: true,
    normalized10: digits,
    formatted: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
  };
}

/**
 * Extracts normalized 10-digit Indian phone key for duplicate checks (returns '' if invalid/short).
 */
export function normalizeIndianPhoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.length === 10 ? digits : '';
}

/**
 * Returns the set of item IDs that share a normalized 10-digit phone number with at least one other item.
 */
export function findDuplicatePhones<
  T extends { id: string; phone_number?: string | null },
>(items: T[]): Set<string> {
  const byPhone = new Map<string, string[]>();
  for (const item of items) {
    const key = normalizeIndianPhoneDigits(item.phone_number);
    if (!key) continue;
    const list = byPhone.get(key) ?? [];
    list.push(item.id);
    byPhone.set(key, list);
  }

  const duplicates = new Set<string>();
  for (const ids of byPhone.values()) {
    if (ids.length > 1) {
      for (const id of ids) {
        duplicates.add(id);
      }
    }
  }
  return duplicates;
}

const STATUS_MAP: Record<string, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  not_generated: 'Not generated',
  pending: 'Needs review',
  inside: 'Inside',
  in: 'Inside',
  outside: 'Outside',
  out: 'Outside',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  open: 'Open',
  in_progress: 'In progress',
  'in progress': 'In progress',
  resolved: 'Resolved',
  out_of_order: 'Out of order',
  'out of order': 'Out of order',
  in_use: 'In use',
  'in use': 'In use',
  free: 'Free',
  published: 'Published',
  draft: 'Draft',
  gate_in: 'Gate in',
  'gate in': 'Gate in',
  gate_out: 'Gate out',
  'gate out': 'Gate out',
  under_review: 'Under review',
  'under review': 'Under review',
  review: 'Under review',
  rejected: 'Rejected',
  active: 'Active',
  your_wash: 'Your wash',
  'your wash': 'Your wash',
  not_enabled: 'Not enabled',
  'not enabled': 'Not enabled',
  all_in_use: 'All in use',
  'all in use': 'All in use',
};

/**
 * Normalizes any status or priority token into consistent Sentence case.
 */
export function toSentenceCaseStatus(status: string | null | undefined): string {
  const clean = (status || '').trim();
  if (!clean) return '';
  const mapped = STATUS_MAP[clean.toLowerCase()];
  if (mapped) return mapped;
  const spaced = clean.replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Formats a gate event ISO timestamp for resident cards.
 * Same local day -> "10:24 pm"; previous days -> "14 Nov, 10:24 pm".
 */
export function formatGateEventTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const timeStr = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return timeStr;
  }

  const dayStr = date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  return `${dayStr}, ${timeStr}`;
}

export function inferPropertyGender(
  name: string,
  dbGender?: string | null
): PropertyGenderType {
  if (dbGender === 'coed' || dbGender === 'girls' || dbGender === 'boys') {
    return dbGender;
  }
  const lower = (name || '').toLowerCase();
  if (/\b(girl|girls|ladies|women|womens|female)\b/.test(lower)) {
    return 'girls';
  }
  if (/\b(boy|boys|mens|men|gents|male)\b/.test(lower)) {
    return 'boys';
  }
  return 'coed';
}

export function formatPropertyGenderLabel(gender: PropertyGenderType): string {
  if (gender === 'girls') return 'Girls';
  if (gender === 'boys') return 'Boys';
  return 'Co-ed';
}

export function isPropertyCompatibleWithGender(
  propertyGender: PropertyGenderType,
  residentGender: ResidentGender
): boolean {
  if (propertyGender === 'coed') return true;
  if (residentGender === 'male') return propertyGender === 'boys';
  if (residentGender === 'female') return propertyGender === 'girls';
  return true;
}

/**
 * Masks an Indian mobile number for privacy on Resident Profile until tapped
 * (e.g., "+91 ••••• 43210").
 */
export function maskIndianPhone(raw: string | null | undefined): string {
  const digits = normalizeIndianPhoneDigits(raw);
  if (!digits) return raw?.trim() || 'Not set';
  return `+91 ••••• ${digits.slice(5)}`;
}

/**
 * Formats an ISO YYYY-MM-DD date string cleanly (e.g., "19 Nov 2026").
 */
export function formatIsoDateDisplay(iso: string | null | undefined): string {
  const clean = (iso || '').trim();
  if (!clean) return 'Not set';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  if (!match) return clean;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return clean;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Computes pro-rata rent in paise from day 1 of the leaving month through leavingDateIso,
 * rounded to the nearest rupee (100 paise).
 */
export function calculateProRataFinalBillPaise(
  monthlyRentPaise: number,
  leavingDateIso: string
): number {
  if (!Number.isFinite(monthlyRentPaise) || monthlyRentPaise <= 0) return 0;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((leavingDateIso || '').trim());
  if (!match) return Math.round(monthlyRentPaise / 100) * 100;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(year, month, 0).getDate();
  if (daysInMonth <= 0) return 0;
  const clampedDay = Math.max(1, Math.min(day, daysInMonth));
  const rawPaise = (monthlyRentPaise * clampedDay) / daysInMonth;
  return Math.round(rawPaise / 100) * 100;
}

/**
 * Strips any accidental leading "Room " / "Rm " prefixes (even repeated like "Room Room D")
 * so room codes normalize consistently across DB rows and UI forms.
 */
export function normalizeRoomCode(raw: string | null | undefined): string {
  let clean = (raw || '').trim().replace(/\s+/g, ' ');
  while (/^(?:room|rm)\s+/i.test(clean)) {
    clean = clean.replace(/^(?:room|rm)\s+/i, '').trim();
  }
  return clean;
}

/**
 * Formats any room code into a single clean display label (e.g. "Room D", "Room 101").
 */
export function formatRoomLabel(raw: string | null | undefined): string {
  const code = normalizeRoomCode(raw);
  return code ? `Room ${code}` : 'Unassigned';
}

/**
 * Natural numeric-aware sort comparator for room codes ("101", "102", "Room D", "A-2").
 */
export function sortRoomCodes(a: string, b: string): number {
  return normalizeRoomCode(a).localeCompare(normalizeRoomCode(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}
