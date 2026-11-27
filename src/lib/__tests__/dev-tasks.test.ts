import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createDevTask,
  cycleDevTaskStatus,
  DEV_TASKS_STORAGE_KEY,
  exportDevTasksToMarkdown,
  isDeveloperAccessAllowed,
  loadDevTasks,
  maskSupabaseUrl,
  saveDevTasks,
} from '@/lib/dev-tasks';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    clear: jest.fn(async () => {
      mockStore.clear();
    }),
  },
}));

describe('dev-tasks store and helpers', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('cycles task status cleanly from todo -> in_progress -> done -> todo', () => {
    expect(cycleDevTaskStatus('todo')).toBe('in_progress');
    expect(cycleDevTaskStatus('in_progress')).toBe('done');
    expect(cycleDevTaskStatus('done')).toBe('todo');
  });

  it('creates, persists, and reloads tasks via AsyncStorage', async () => {
    const taskA = createDevTask({
      title: '  Verify Warden alerts  ',
      priority: 'P0',
      area: 'Warden',
    });
    const taskB = createDevTask({
      title: 'Check billing export CSV',
      priority: 'P2',
      area: 'Owner',
      status: 'done',
    });

    expect(taskA.title).toBe('Verify Warden alerts');
    expect(taskA.status).toBe('todo');

    await saveDevTasks([taskA, taskB]);
    const loaded = await loadDevTasks();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].title).toBe('Verify Warden alerts');
    expect(loaded[1].status).toBe('done');
  });

  it('throws on empty task title', () => {
    expect(() => createDevTask({ title: '   ' })).toThrow(
      'Task title cannot be empty.'
    );
  });

  it('handles corrupted storage gracefully', async () => {
    await AsyncStorage.setItem(DEV_TASKS_STORAGE_KEY, '{not-valid-json');
    const loaded = await loadDevTasks();
    expect(loaded).toEqual([]);
  });

  it('exports tasks grouped by status as clean Markdown', () => {
    const t1 = createDevTask({
      title: 'Polish Warden UI',
      priority: 'P0',
      area: 'Warden',
      status: 'in_progress',
    });
    const t2 = createDevTask({
      title: 'Ship Billing safety',
      priority: 'P1',
      area: 'Owner',
      status: 'done',
    });

    const md = exportDevTasksToMarkdown([t1, t2]);
    expect(md).toContain('# PGwala Developer Tasks (1/2 Done)');
    expect(md).toContain('## In Progress (1)');
    expect(md).toContain('- [~] **[P0]** `Warden` Polish Warden UI');
    expect(md).toContain('## Done (1)');
    expect(md).toContain('- [x] **[P1]** `Owner` Ship Billing safety');
  });

  it('gates developer access by __DEV__ or allowlisted email', () => {
    expect(
      isDeveloperAccessAllowed(null, { isDevBuild: true, allowlistRaw: '' })
    ).toBe(true);
    expect(
      isDeveloperAccessAllowed('random@example.com', {
        isDevBuild: false,
        allowlistRaw: 'dev@pgwala.in, founder@pgwala.in',
      })
    ).toBe(false);
    expect(
      isDeveloperAccessAllowed('DEV@pgwala.in', {
        isDevBuild: false,
        allowlistRaw: 'dev@pgwala.in, founder@pgwala.in',
      })
    ).toBe(true);
    expect(
      isDeveloperAccessAllowed('admin.pgwala@gmail.com', {
        isDevBuild: false,
        allowlistRaw: '',
      })
    ).toBe(true);
    expect(
      isDeveloperAccessAllowed('rajesh.pg@gmail.com', {
        isDevBuild: false,
        allowlistRaw: '',
      })
    ).toBe(false);
  });

  it('masks Supabase URLs safely', () => {
    expect(maskSupabaseUrl('https://abcdefghijkl.supabase.co')).toBe(
      'abcdef….supabase.co'
    );
    expect(maskSupabaseUrl('')).toBe('Not configured');
  });
});
