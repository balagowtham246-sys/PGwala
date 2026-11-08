/**
 * Chat and Messaging Utilities for PGwala
 */

/**
 * Resolves the display name for a chat message sender.
 * Uses sender_name from the chat record, then resident profile name, then falls back to 'Resident'.
 */
export function getChatSenderDisplayName(
  senderName?: string | null,
  fallbackName?: string | null
): string {
  if (senderName && senderName.trim().length > 0) {
    return senderName.trim();
  }
  if (fallbackName && fallbackName.trim().length > 0) {
    return fallbackName.trim();
  }
  return 'Resident';
}

/**
 * Formats the room number subtitle for message bubble headers (e.g. "Rm 102").
 */
export function formatSenderRoomSubtitle(roomNumber?: string | null): string {
  if (!roomNumber || !roomNumber.trim()) return '';
  const trimmed = roomNumber.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('rm') || lower.startsWith('room')) {
    return trimmed;
  }
  return `Rm ${trimmed}`;
}

