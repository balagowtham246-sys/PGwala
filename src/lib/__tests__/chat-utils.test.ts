import {
  getChatSenderDisplayName,
  formatSenderRoomSubtitle,
} from '../chat-utils';

describe('chat-utils', () => {
  describe('getChatSenderDisplayName', () => {
    it('returns direct senderName if available', () => {
      expect(getChatSenderDisplayName('Rohan Sharma', 'Alex')).toBe('Rohan Sharma');
      expect(getChatSenderDisplayName('Priya Patel', null)).toBe('Priya Patel');
    });

    it('falls back to fallbackName if senderName is missing or whitespace', () => {
      expect(getChatSenderDisplayName(null, 'Karthik Raja')).toBe('Karthik Raja');
      expect(getChatSenderDisplayName(undefined, 'Anita')).toBe('Anita');
      expect(getChatSenderDisplayName('', 'Vikram')).toBe('Vikram');
      expect(getChatSenderDisplayName('   ', 'Vikram')).toBe('Vikram');
    });

    it('falls back to Resident if both senderName and fallbackName are empty or null', () => {
      expect(getChatSenderDisplayName(null, null)).toBe('Resident');
      expect(getChatSenderDisplayName(undefined, undefined)).toBe('Resident');
      expect(getChatSenderDisplayName('', '')).toBe('Resident');
      expect(getChatSenderDisplayName('   ', '   ')).toBe('Resident');
    });
  });

  describe('formatSenderRoomSubtitle', () => {
    it('prepends Rm to plain room numbers', () => {
      expect(formatSenderRoomSubtitle('101')).toBe('Rm 101');
      expect(formatSenderRoomSubtitle('B-204')).toBe('Rm B-204');
    });

    it('preserves existing Rm or Room prefix', () => {
      expect(formatSenderRoomSubtitle('Rm 102')).toBe('Rm 102');
      expect(formatSenderRoomSubtitle('room 301')).toBe('room 301');
    });

    it('returns empty string if roomNumber is null, undefined, or blank', () => {
      expect(formatSenderRoomSubtitle(null)).toBe('');
      expect(formatSenderRoomSubtitle(undefined)).toBe('');
      expect(formatSenderRoomSubtitle('')).toBe('');
      expect(formatSenderRoomSubtitle('   ')).toBe('');
    });
  });
});

