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
