import QRCode from 'qrcode';

export const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;

/**
 * Strips whitespace/hyphens and uppercases a PG invite code.
 */
export function normalizeInviteCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, INVITE_CODE_LENGTH);
}

/**
 * Formats a 6-character code with a space in the middle for easy reading on posters (e.g. "SHAL7K" -> "SHA L7K").
 */
export function formatInviteCodeDisplay(code: string | null | undefined): string {
  const norm = normalizeInviteCode(code);
  if (norm.length !== INVITE_CODE_LENGTH) return norm;
  return `${norm.slice(0, 3)} ${norm.slice(3)}`;
}

export function isValidInviteCodeFormat(raw: string | null | undefined): boolean {
  return INVITE_CODE_PATTERN.test(normalizeInviteCode(raw));
}

/**
 * Builds the Expo Router deep link encoded inside the printable PG QR poster.
 */
export function buildJoinDeepLink(code: string): string {
  const norm = normalizeInviteCode(code);
  return `pgwala://join-pg?code=${encodeURIComponent(norm)}`;
}

/**
 * Builds the Expo Router deep link encoded inside the physical Gate Check-In QR poster.
 */
export function buildGateCheckInDeepLink(propertyId: string): string {
  return `pgwala://resident-gate-history?propertyId=${encodeURIComponent(propertyId.trim())}&source=gate_qr`;
}

/**
 * Builds a shareable WhatsApp/print text for the physical entrance Gate Check-In QR poster.
 */
export function buildGatePosterShareMessage(params: {
  propertyName: string;
  propertyId: string;
}): string {
  return [
    `*${params.propertyName} — Gate Check-In / Out QR*`,
    '',
    'Scan the entrance QR code in PGwala whenever leaving or returning to the PG.',
    '',
    `Quick Gate Link: ${buildGateCheckInDeepLink(params.propertyId)}`,
  ].join('\n');
}

/**
 * Builds a crisp, WhatsApp-ready vacancy broadcast card for PG owners (zero-CAC growth).
 */
export function buildVacancyShareMessage(params: {
  propertyName: string;
  address?: string | null;
  genderLabel?: string | null;
  freeBedsCount: number;
  vacatingBedsCount?: number;
  roomHighlights?: string[];
  inviteCode?: string | null;
}): string {
  const lines: string[] = [];
  const headerTag = params.genderLabel ? ` (${params.genderLabel})` : '';
  lines.push(`*Beds Available at ${params.propertyName}${headerTag}*`);
  if (params.address?.trim()) {
    lines.push(`Location: ${params.address.trim()}`);
  }
  lines.push('');

  const summaryParts: string[] = [];
  if (params.freeBedsCount > 0) {
    summaryParts.push(
      `${params.freeBedsCount} free bed${params.freeBedsCount === 1 ? '' : 's'} ready now`
    );
  }
  if (params.vacatingBedsCount && params.vacatingBedsCount > 0) {
    summaryParts.push(
      `${params.vacatingBedsCount} vacating soon`
    );
  }
  if (summaryParts.length > 0) {
    lines.push(`Availability: ${summaryParts.join(' · ')}`);
  }

  if (params.roomHighlights && params.roomHighlights.length > 0) {
    lines.push(`Rooms: ${params.roomHighlights.slice(0, 6).join(', ')}`);
  }

  lines.push('');
  if (params.inviteCode) {
    lines.push(`Join directly on PGwala with code: *${normalizeInviteCode(params.inviteCode)}*`);
  } else {
    lines.push('Reply or call to book a visit and reserve your bed today!');
  }

  return lines.join('\n');
}

/**
 * Builds a friendly, zero-cost WhatsApp message owners can forward to new or existing residents.
 */
export function buildInviteWhatsAppMessage(params: {
  propertyName: string;
  inviteCode: string;
}): string {
  const norm = normalizeInviteCode(params.inviteCode);
  return [
    `Welcome to *${params.propertyName}* on PGwala!`,
    '',
    `To register yourself as a resident:`,
    `1. Open the *PGwala* app`,
    `2. Tap *"Join a PG with Invite Code"*`,
    `3. Enter Invite Code: *${norm}*`,
    '',
    `Or tap directly if PGwala is installed:`,
    buildJoinDeepLink(norm),
  ].join('\n');
}

export interface QrMatrixResult {
  size: number;
  pathData: string;
}

/**
 * Generates an SVG path string representing all dark modules of a QR code.
 * Uses pure-JS `qrcode` + `react-native-svg` (0 extra native dependencies / 0 APK bloat).
 */
export function buildQrSvgPath(value: string): QrMatrixResult {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const segments: string[] = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) {
        segments.push(`M${col},${row}h1v1h-1z`);
      }
    }
  }

  return {
    size,
    pathData: segments.join(''),
  };
}
