/**
 * Centralized TanStack Query key factory for PGwala domains.
 * Keeps cache keys consistent across screens, hooks, and invalidation helpers.
 */
export const queryKeys = {
  billing: {
    all: ['billing'] as const,
    owner: (propertyId: string | null | undefined, monthIsoStart: string) =>
      ['billing', 'owner', propertyId ?? 'auto', monthIsoStart.slice(0, 7)] as const,
    student: (userId: string) => ['billing', 'student', userId] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    owner: (propertyId: string, dateIso: string) =>
      ['dashboard', 'owner', propertyId, dateIso] as const,
    ownerInbox: (userId: string, propertyId: string) =>
      ['dashboard', 'ownerInbox', userId, propertyId] as const,
    student: (userId: string, dateIso: string) =>
      ['dashboard', 'student', userId, dateIso] as const,
    studentNotices: (userId: string, propertyId: string, roomNumber: string) =>
      ['dashboard', 'studentNotices', userId, propertyId, roomNumber] as const,
    warden: (userId: string) => ['dashboard', 'warden', userId] as const,
  },
  residents: {
    all: ['residents'] as const,
    directory: (propertyId: string) =>
      ['residents', 'directory', propertyId] as const,
    detail: (residentId: string) =>
      ['residents', 'detail', residentId] as const,
    activePeers: (propertyId: string) =>
      ['residents', 'activePeers', propertyId] as const,
  },
  complaints: {
    all: ['complaints'] as const,
    owner: (propertyId: string) => ['complaints', 'owner', propertyId] as const,
    student: (residentId: string) =>
      ['complaints', 'student', residentId] as const,
  },
  movement: {
    all: ['movement'] as const,
    property: (propertyId: string) =>
      ['movement', 'property', propertyId] as const,
    resident: (residentId: string) =>
      ['movement', 'resident', residentId] as const,
  },
  foodMenus: {
    all: ['foodMenus'] as const,
    ownerProperty: (ownerId: string) =>
      ['foodMenus', 'ownerProperty', ownerId] as const,
    property: (propertyId: string, dateIso?: string) =>
      ['foodMenus', 'property', propertyId, dateIso ?? 'all'] as const,
    student: (propertyId: string, anchorIso: string) =>
      ['foodMenus', 'student', propertyId, anchorIso] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    property: (propertyId: string) =>
      ['announcements', 'property', propertyId] as const,
  },
  washingMachine: {
    all: ['washingMachine'] as const,
    property: (propertyId: string) =>
      ['washingMachine', 'property', propertyId] as const,
  },
} as const;
