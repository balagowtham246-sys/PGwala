import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEV_TASKS_STORAGE_KEY = '@pgwala_dev_tasks_v1';

export type DevTaskStatus = 'todo' | 'in_progress' | 'done';
export type DevTaskPriority = 'P0' | 'P1' | 'P2';
export type DevTaskArea =
  | 'Owner'
  | 'Resident'
  | 'Warden'
  | 'Backend'
  | 'Bug'
  | 'General';

export interface DevTaskItem {
  id: string;
  title: string;
  status: DevTaskStatus;
  priority: DevTaskPriority;
  area: DevTaskArea;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDevTaskInput {
  title: string;
  priority?: DevTaskPriority;
  area?: DevTaskArea;
  status?: DevTaskStatus;
}

export const DEV_TASK_STATUS_ORDER: readonly DevTaskStatus[] = [
  'todo',
  'in_progress',
  'done',
];

export const DEV_TASK_PRIORITIES: readonly DevTaskPriority[] = [
  'P0',
  'P1',
  'P2',
];

export const DEV_TASK_AREAS: readonly DevTaskArea[] = [
  'Owner',
  'Resident',
  'Warden',
  'Backend',
  'Bug',
  'General',
];

/**
 * Gates Developer Monitor access to dev builds (__DEV__) or explicitly
 * allowlisted developer emails via EXPO_PUBLIC_DEV_EMAILS (comma-separated).
 */
export function isDeveloperAccessAllowed(
  userEmail?: string | null,
  options?: { isDevBuild?: boolean; allowlistRaw?: string }
): boolean {
  const isDev =
    options?.isDevBuild !== undefined
      ? options.isDevBuild
      : typeof __DEV__ !== 'undefined' && __DEV__;
  if (isDev) return true;

  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const rawList =
    options?.allowlistRaw !== undefined
      ? options.allowlistRaw
      : (process.env.EXPO_PUBLIC_DEV_EMAILS ?? '');

  if (!rawList.trim()) return false;

  const allowed = rawList
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(normalizedEmail);
}

export function maskSupabaseUrl(rawUrl?: string | null): string {
  if (!rawUrl || !rawUrl.trim()) return 'Not configured';
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname;
    if (host.length <= 10) return host;
    const prefix = host.slice(0, 6);
    const suffix = host.slice(-12);
    return `${prefix}…${suffix}`;
  } catch {
    return 'Configured';
  }
}

export function cycleDevTaskStatus(status: DevTaskStatus): DevTaskStatus {
  const idx = DEV_TASK_STATUS_ORDER.indexOf(status);
  if (idx === -1) return 'todo';
  return DEV_TASK_STATUS_ORDER[(idx + 1) % DEV_TASK_STATUS_ORDER.length];
}

export function createDevTask(input: CreateDevTaskInput): DevTaskItem {
  const trimmed = input.title.trim();
  if (!trimmed) {
    throw new Error('Task title cannot be empty.');
  }
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return {
    id: `devtask-${now}-${rand}`,
    title: trimmed,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'P1',
    area: input.area ?? 'General',
    createdAt: now,
    updatedAt: now,
  };
}

export function getStarterRoadmapTasks(): DevTaskItem[] {
  const now = Date.now();
  return [
    {
      id: `devtask-seed-1-${now}`,
      title: 'Plan 1: Polish remaining Owner screens (Receipts, Directory, Settings)',
      status: 'todo',
      priority: 'P1',
      area: 'Owner',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `devtask-seed-2-${now}`,
      title: 'Plan 2: Polish remaining Resident screens (Billing, Menu, Chat)',
      status: 'todo',
      priority: 'P1',
      area: 'Resident',
      createdAt: now + 1,
      updatedAt: now + 1,
    },
    {
      id: `devtask-seed-3-${now}`,
      title: 'Plan 3: Simplify Warden Dashboard to 2-second frontline UI',
      status: 'todo',
      priority: 'P0',
      area: 'Warden',
      createdAt: now + 2,
      updatedAt: now + 2,
    },
    {
      id: `devtask-seed-4-${now}`,
      title: 'Run Expo Go manual QA across Owner, Resident & Warden roles',
      status: 'todo',
      priority: 'P1',
      area: 'General',
      createdAt: now + 3,
      updatedAt: now + 3,
    },
  ];
}

export async function loadDevTasks(): Promise<DevTaskItem[]> {
  try {
    const raw = await AsyncStorage.getItem(DEV_TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DevTaskItem =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        DEV_TASK_STATUS_ORDER.includes(item.status) &&
        DEV_TASK_PRIORITIES.includes(item.priority) &&
        DEV_TASK_AREAS.includes(item.area)
    );
  } catch {
    return [];
  }
}

export async function saveDevTasks(tasks: DevTaskItem[]): Promise<void> {
  await AsyncStorage.setItem(DEV_TASKS_STORAGE_KEY, JSON.stringify(tasks));
}

export function exportDevTasksToMarkdown(tasks: DevTaskItem[]): string {
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;

  const lines: string[] = [
    `# PGwala Developer Tasks (${doneCount}/${tasks.length} Done)`,
    `> Todo: ${todoCount} | In Progress: ${inProgressCount} | Done: ${doneCount}`,
    '',
  ];

  const sections: { label: string; status: DevTaskStatus; checkbox: string }[] =
    [
      { label: 'In Progress', status: 'in_progress', checkbox: '[~]' },
      { label: 'Todo', status: 'todo', checkbox: '[ ]' },
      { label: 'Done', status: 'done', checkbox: '[x]' },
    ];

  for (const section of sections) {
    const items = tasks.filter((t) => t.status === section.status);
    if (items.length === 0) continue;
    lines.push(`## ${section.label} (${items.length})`);
    for (const item of items) {
      lines.push(
        `- ${section.checkbox} **[${item.priority}]** \`${item.area}\` ${item.title}`
      );
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}
