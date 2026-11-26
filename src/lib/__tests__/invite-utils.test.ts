import {
  buildGateCheckInDeepLink,
  buildGatePosterShareMessage,
  buildInviteWhatsAppMessage,
  buildJoinDeepLink,
  buildQrSvgPath,
  buildVacancyShareMessage,
  formatInviteCodeDisplay,
  isValidInviteCodeFormat,
  normalizeInviteCode,
} from '@/lib/invite-utils';

describe('invite-utils', () => {
  it('normalizes lowercase, spaces, and symbols to clean 6-char uppercase code', () => {
    expect(normalizeInviteCode('  sha-l7k ')).toBe('SHAL7K');
    expect(normalizeInviteCode('ab12cd99')).toBe('AB12CD');
    expect(normalizeInviteCode(null)).toBe('');
  });

  it('formats 6-character code cleanly for poster readability', () => {
    expect(formatInviteCodeDisplay('shal7k')).toBe('SHA L7K');
    expect(formatInviteCodeDisplay('AB1')).toBe('AB1');
  });

  it('validates 6-character alphanumeric invite code format', () => {
    expect(isValidInviteCodeFormat('SHAL7K')).toBe(true);
    expect(isValidInviteCodeFormat('sha-l7k')).toBe(true);
    expect(isValidInviteCodeFormat('SHAL7')).toBe(false);
    expect(isValidInviteCodeFormat('')).toBe(false);
  });

  it('builds deep link and WhatsApp share message cleanly', () => {
    expect(buildJoinDeepLink('shal7k')).toBe('pgwala://join-pg?code=SHAL7K');
    const msg = buildInviteWhatsAppMessage({
      propertyName: 'Shalom Residency',
      inviteCode: 'shal7k',
    });
    expect(msg).toContain('Shalom Residency');
    expect(msg).toContain('*SHAL7K*');
    expect(msg).toContain('pgwala://join-pg?code=SHAL7K');
  });

  it('generates a valid QR SVG matrix path for deep links', () => {
    const { size, pathData } = buildQrSvgPath('pgwala://join-pg?code=SHAL7K');
    expect(size).toBeGreaterThanOrEqual(21);
    expect(pathData.startsWith('M')).toBe(true);
    expect(pathData.length).toBeGreaterThan(200);
  });

  it('builds Gate Check-In QR deep link and share message', () => {
    const link = buildGateCheckInDeepLink('prop-123');
    expect(link).toBe('pgwala://resident-gate-history?propertyId=prop-123&source=gate_qr');
    const msg = buildGatePosterShareMessage({
      propertyName: 'Sri Lakshmi PG',
      propertyId: 'prop-123',
    });
    expect(msg).toContain('Sri Lakshmi PG');
    expect(msg).toContain(link);
  });

  it('builds WhatsApp-ready vacancy share message with room highlights', () => {
    const msg = buildVacancyShareMessage({
      propertyName: 'Sri Lakshmi PG',
      address: 'Coimbatore',
      genderLabel: 'Boys',
      freeBedsCount: 3,
      vacatingBedsCount: 1,
      roomHighlights: ['Room 101 (2 free)', 'Room 102 (1 free)'],
    });
    expect(msg).toContain('Sri Lakshmi PG (Boys)');
    expect(msg).toContain('3 free beds ready now');
    expect(msg).toContain('1 vacating soon');
    expect(msg).toContain('Room 101 (2 free)');
  });
});
