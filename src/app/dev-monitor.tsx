import Constants from 'expo-constants';
import { Href, router } from 'expo-router';
import {
  Activity,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Database,
  ExternalLink,
  Plus,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Trash2,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerHeader, SegmentedFilter } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import {
  createDevTask,
  cycleDevTaskStatus,
  DEV_TASK_AREAS,
  DEV_TASK_PRIORITIES,
  DevTaskArea,
  DevTaskItem,
  DevTaskPriority,
  DevTaskStatus,
  exportDevTasksToMarkdown,
  getStarterRoadmapTasks,
  isDeveloperAccessAllowed,
  loadDevTasks,
  maskSupabaseUrl,
  saveDevTasks,
} from '@/lib/dev-tasks';
import { getOfflineQueue, OfflineQueueItem } from '@/lib/offline-queue';
import {
  getPerfSnapshot,
  PerfSnapshot,
  resetPerfMonitor,
} from '@/lib/perf-monitor';
import { queryClient } from '@/lib/query-client';

type DevTab = 'TASKS' | 'HEALTH' | 'JUMP';
type TaskFilter = 'ALL' | DevTaskStatus;

const PRIORITY_COLORS: Record<
  DevTaskPriority,
  { bg: string; text: string; border: string }
> = {
  P0: { bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA' },
  P1: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  P2: { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
};

const QUICK_JUMP_GROUPS: {
  title: string;
  routes: { label: string; path: Href; subtitle: string }[];
}[] = [
  {
    title: 'Owner Screens',
    routes: [
      { label: 'Owner Home', path: '/owner-tabs', subtitle: 'Hero dashboard & ops' },
      { label: 'Billing', path: '/billing-management', subtitle: 'Rent, EB & receipts' },
      { label: 'Gate Attendance', path: '/resident-in-out', subtitle: 'Inside/Outside & Late' },
      { label: 'Food Menu', path: '/food-menu', subtitle: 'Daily meals & editor' },
      { label: 'Maintenance', path: '/owner-complaints', subtitle: 'Issues & log sheet' },
      { label: 'Residents Directory', path: '/residents-directory', subtitle: 'All rooms & dues' },
      { label: 'Owner Settings', path: '/owner-settings', subtitle: 'Properties & wardens' },
    ],
  },
  {
    title: 'Shared & Utility',
    routes: [
      { label: 'Announcements', path: '/owner-announcements', subtitle: 'Push & WhatsApp notices' },
      { label: 'Notifications Center', path: '/notification-center', subtitle: 'All alerts feed' },
      { label: 'Add Resident', path: '/add-resident', subtitle: 'Onboarding form' },
    ],
  },
];

export default function DevMonitorScreen() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();

  const allowed = isDeveloperAccessAllowed(user?.email);

  const [activeTab, setActiveTab] = useState<DevTab>('TASKS');
  const [tasks, setTasks] = useState<DevTaskItem[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('ALL');

  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<DevTaskPriority>('P1');
  const [newArea, setNewArea] = useState<DevTaskArea>('Owner');

  const [perf, setPerf] = useState<PerfSnapshot>(() => getPerfSnapshot());
  const [offlineItems, setOfflineItems] = useState<OfflineQueueItem[]>([]);
  const [queryStats, setQueryStats] = useState(() => {
    const allQueries = queryClient.getQueryCache().getAll();
    return {
      total: allQueries.length,
      stale: allQueries.filter((q) => q.isStale()).length,
      errored: allQueries.filter((q) => q.state.status === 'error').length,
    };
  });

  const refreshHealth = useCallback(async () => {
    setPerf(getPerfSnapshot());
    const queue = await getOfflineQueue();
    setOfflineItems(queue);

    const allQueries = queryClient.getQueryCache().getAll();
    const stale = allQueries.filter((q) => q.isStale()).length;
    const errored = allQueries.filter((q) => q.state.status === 'error').length;
    setQueryStats({
      total: allQueries.length,
      stale,
      errored,
    });
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void Promise.all([loadDevTasks(), getOfflineQueue()]).then(
      ([loaded, queue]) => {
        if (active) {
          setTasks(loaded);
          setTasksLoaded(true);
          setOfflineItems(queue);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [allowed]);

  const persistTasks = useCallback((next: DevTaskItem[]) => {
    setTasks(next);
    void saveDevTasks(next);
  }, []);

  const handleAddTask = useCallback(() => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const created = createDevTask({
      title: trimmed,
      priority: newPriority,
      area: newArea,
    });
    persistTasks([created, ...tasks]);
    setNewTitle('');
    showToast('Task added to Dev Monitor.');
  }, [newArea, newPriority, newTitle, persistTasks, showToast, tasks]);

  const handleCycleStatus = useCallback(
    (id: string) => {
      const next = tasks.map((t) =>
        t.id === id
          ? { ...t, status: cycleDevTaskStatus(t.status), updatedAt: Date.now() }
          : t
      );
      persistTasks(next);
    },
    [persistTasks, tasks]
  );

  const handleDeleteTask = useCallback(
    (id: string) => {
      persistTasks(tasks.filter((t) => t.id !== id));
    },
    [persistTasks, tasks]
  );

  const handleSeedRoadmap = useCallback(() => {
    const starter = getStarterRoadmapTasks();
    persistTasks([...starter, ...tasks]);
    showToast('PGwala roadmap tasks loaded.');
  }, [persistTasks, showToast, tasks]);

  const shareOrCopyText = useCallback(
    async (text: string, title: string, toastMessage: string) => {
      if (
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
      ) {
        try {
          await navigator.clipboard.writeText(text);
          showToast(toastMessage);
          return;
        } catch {
          // Fall through to Share
        }
      }
      try {
        await Share.share({ title, message: text });
      } catch {
        Alert.alert('Share Unavailable', 'Could not share text on this device.');
      }
    },
    [showToast]
  );

  const handleExportTasks = useCallback(() => {
    if (tasks.length === 0) {
      Alert.alert('No Tasks', 'Add at least one task before exporting.');
      return;
    }
    const md = exportDevTasksToMarkdown(tasks);
    void shareOrCopyText(
      md,
      'PGwala Dev Tasks',
      'Markdown task summary copied to clipboard.'
    );
  }, [shareOrCopyText, tasks]);

  const handleCopyDiagnostics = useCallback(() => {
    const report = [
      `PGwala Dev Diagnostics`,
      `Version: ${Constants.expoConfig?.version || '1.0.0'} (Expo ${
        Constants.expoConfig?.sdkVersion || 'runtime'
      })`,
      `Platform: ${Platform.OS} (${__DEV__ ? 'DEV' : 'PROD'})`,
      `Role: ${profile?.role || 'unknown'}`,
      `Supabase: ${maskSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL)}`,
      `Queries: ${queryStats.total} total (${queryStats.stale} stale, ${queryStats.errored} error)`,
      `Offline Queue: ${offlineItems.length} pending`,
      `Perf Traces: ${perf.totals.completedTraces} (${perf.totals.totalRoundTrips} round trips)`,
    ].join('\n');
    void shareOrCopyText(
      report,
      'PGwala Diagnostics',
      'Diagnostics report copied to clipboard.'
    );
  }, [
    offlineItems.length,
    perf.totals.completedTraces,
    perf.totals.totalRoundTrips,
    profile?.role,
    queryStats.errored,
    queryStats.stale,
    queryStats.total,
    shareOrCopyText,
  ]);

  const handleClearQueryCache = useCallback(() => {
    Alert.alert(
      'Clear React Query Cache?',
      'All cached screen data will be invalidated and refetched on next visit.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: () => {
            queryClient.clear();
            void refreshHealth();
            showToast('React Query cache cleared.');
          },
        },
      ]
    );
  }, [refreshHealth, showToast]);

  const taskCounts = useMemo(() => {
    let todo = 0;
    let inProgress = 0;
    let done = 0;
    for (const t of tasks) {
      if (t.status === 'done') done += 1;
      else if (t.status === 'in_progress') inProgress += 1;
      else todo += 1;
    }
    const percent =
      tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
    return { todo, inProgress, done, total: tasks.length, percent };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (taskFilter === 'ALL') return tasks;
    return tasks.filter((t) => t.status === taskFilter);
  }, [taskFilter, tasks]);

  const renderTaskItem = useCallback(
    ({ item }: { item: DevTaskItem }) => {
      const prioStyle = PRIORITY_COLORS[item.priority];
      const isDone = item.status === 'done';
      const isInProgress = item.status === 'in_progress';

      return (
        <View style={[styles.taskCard, isDone && styles.taskCardDone]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Cycle status for ${item.title}`}
            style={styles.taskStatusBtn}
            onPress={() => handleCycleStatus(item.id)}>
            {isDone ? (
              <CheckCircle2 size={20} color="#10B981" />
            ) : isInProgress ? (
              <Clock size={20} color="#F59E0B" />
            ) : (
              <Circle size={20} color="#94A3B8" />
            )}
          </Pressable>

          <Pressable
            style={styles.taskBody}
            onPress={() => handleCycleStatus(item.id)}>
            <Text
              style={[styles.taskTitle, isDone && styles.taskTitleDone]}
              numberOfLines={2}>
              {item.title}
            </Text>
            <View style={styles.taskMetaRow}>
              <View
                style={[
                  styles.metaChip,
                  {
                    backgroundColor: prioStyle.bg,
                    borderColor: prioStyle.border,
                  },
                ]}>
                <Text style={[styles.metaChipText, { color: prioStyle.text }]}>
                  {item.priority}
                </Text>
              </View>
              <View style={styles.areaChip}>
                <Text style={styles.areaChipText}>{item.area}</Text>
              </View>
              <Text style={styles.statusLabelText}>
                {isDone ? 'Done' : isInProgress ? 'In progress' : 'Todo'}
              </Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.title}`}
            hitSlop={8}
            style={styles.deleteBtn}
            onPress={() => handleDeleteTask(item.id)}>
            <Trash2 size={16} color="#94A3B8" />
          </Pressable>
        </View>
      );
    },
    [handleCycleStatus, handleDeleteTask]
  );

  const taskKeyExtractor = useCallback((item: DevTaskItem) => item.id, []);

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <OwnerHeader title="Developer Monitor" showBack />
        <View style={styles.blockedWrap}>
          <ShieldAlert size={36} color={OwnerTheme.colors.danger} />
          <Text style={styles.blockedTitle}>Developer Access Required</Text>
          <Text style={styles.blockedSub}>
            This hub is restricted to development builds or allowlisted
            developer accounts.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Developer Monitor"
        subtitle={`v${Constants.expoConfig?.version || '1.0.0'} • ${
          __DEV__ ? 'DEV' : 'PROD'
        }`}
        showBack
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export tasks as Markdown"
            style={({ pressed }) => [
              styles.headerBtn,
              pressed && { opacity: 0.75 },
            ]}
            onPress={handleExportTasks}>
            <Copy size={14} color={OwnerTheme.colors.primary} />
            <Text style={styles.headerBtnText}>Export</Text>
          </Pressable>
        }
      />

      <View style={styles.contentWrap}>
        {/* Dark-Slate Dev Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroEyebrow}>PGWALA DEV HUB</Text>
              <Text style={styles.heroMetric}>
                {taskCounts.done}/{taskCounts.total}{' '}
                <Text style={styles.heroMetricSub}>tasks done</Text>
              </Text>
            </View>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>
                {(profile?.role || 'owner').toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${taskCounts.percent}%` },
              ]}
            />
          </View>

          <View style={styles.heroFooterRow}>
            <Text style={styles.heroFooterText} numberOfLines={1}>
              DB: {maskSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL)}
            </Text>
            <Text style={styles.heroFooterText}>
              {queryStats.total} queries · {offlineItems.length} queued
            </Text>
          </View>
        </View>

        <SegmentedFilter
          options={[
            { key: 'TASKS', label: 'My Tasks', count: taskCounts.total },
            { key: 'HEALTH', label: 'App Health' },
            { key: 'JUMP', label: 'Quick Jump' },
          ]}
          activeKey={activeTab}
          onSelect={(key) => {
            const nextTab = key as DevTab;
            setActiveTab(nextTab);
            if (nextTab === 'HEALTH') {
              void refreshHealth();
            }
          }}
          style={{ marginBottom: 12 }}
        />

        {activeTab === 'TASKS' && (
          <View style={{ flex: 1 }}>
            {/* Quick-Add Composer */}
            <View style={styles.composerCard}>
              <View style={styles.composerRow}>
                <TextInput
                  style={styles.composerInput}
                  placeholder="Add a PGwala task or bug..."
                  placeholderTextColor="#94A3B8"
                  value={newTitle}
                  onChangeText={setNewTitle}
                  onSubmitEditing={handleAddTask}
                  returnKeyType="done"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add task"
                  disabled={!newTitle.trim()}
                  style={[
                    styles.addBtn,
                    !newTitle.trim() && { opacity: 0.45 },
                  ]}
                  onPress={handleAddTask}>
                  <Plus size={18} color="#FFFFFF" />
                </Pressable>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pickerRow}>
                {DEV_TASK_PRIORITIES.map((p) => {
                  const active = newPriority === p;
                  return (
                    <Pressable
                      key={p}
                      style={[
                        styles.smallPill,
                        active && styles.smallPillActive,
                      ]}
                      onPress={() => setNewPriority(p)}>
                      <Text
                        style={[
                          styles.smallPillText,
                          active && styles.smallPillTextActive,
                        ]}>
                        {p}
                      </Text>
                    </Pressable>
                  );
                })}
                <View style={styles.pillDivider} />
                {DEV_TASK_AREAS.map((area) => {
                  const active = newArea === area;
                  return (
                    <Pressable
                      key={area}
                      style={[
                        styles.smallPill,
                        active && styles.smallPillActive,
                      ]}
                      onPress={() => setNewArea(area)}>
                      <Text
                        style={[
                          styles.smallPillText,
                          active && styles.smallPillTextActive,
                        ]}>
                        {area}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Status Filter Row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginBottom: 10 }}
              contentContainerStyle={{ gap: 6 }}>
              {(
                [
                  { key: 'ALL', label: `All (${taskCounts.total})` },
                  { key: 'todo', label: `Todo (${taskCounts.todo})` },
                  {
                    key: 'in_progress',
                    label: `Doing (${taskCounts.inProgress})`,
                  },
                  { key: 'done', label: `Done (${taskCounts.done})` },
                ] as { key: TaskFilter; label: string }[]
              ).map((f) => {
                const active = taskFilter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    style={[
                      styles.filterChip,
                      active && styles.filterChipActive,
                    ]}
                    onPress={() => setTaskFilter(f.key)}>
                    <Text
                      style={[
                        styles.filterChipText,
                        active && styles.filterChipTextActive,
                      ]}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <FlatList
              data={filteredTasks}
              keyExtractor={taskKeyExtractor}
              renderItem={renderTaskItem}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}
              ListEmptyComponent={
                tasksLoaded ? (
                  <View style={styles.emptyCard}>
                    <Rocket size={26} color={OwnerTheme.colors.primary} />
                    <Text style={styles.emptyTitle}>No tasks here yet</Text>
                    <Text style={styles.emptySub}>
                      Add your own tasks above, or load the PGwala polish
                      roadmap in one tap.
                    </Text>
                    {tasks.length === 0 && (
                      <Pressable
                        style={styles.seedBtn}
                        onPress={handleSeedRoadmap}>
                        <Text style={styles.seedBtnText}>
                          + Load PGwala Roadmap
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : undefined
              }
            />
          </View>
        )}

        {activeTab === 'HEALTH' && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 36, gap: 12 }}>
            <View style={styles.healthGrid}>
              <View style={styles.healthStatCard}>
                <Database size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.healthStatValue}>{queryStats.total}</Text>
                <Text style={styles.healthStatLabel}>Cached Queries</Text>
                <Text style={styles.healthStatSub}>
                  {queryStats.stale} stale · {queryStats.errored} error
                </Text>
              </View>
              <View style={styles.healthStatCard}>
                <Activity size={16} color="#10B981" />
                <Text style={styles.healthStatValue}>
                  {perf.totals.completedTraces}
                </Text>
                <Text style={styles.healthStatLabel}>Perf Traces</Text>
                <Text style={styles.healthStatSub}>
                  {perf.totals.totalRoundTrips} round trips
                </Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Offline Queue ({offlineItems.length})
                </Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => void refreshHealth()}
                  style={styles.inlineRefreshBtn}>
                  <RefreshCw size={13} color={OwnerTheme.colors.primary} />
                  <Text style={styles.inlineRefreshText}>Refresh</Text>
                </Pressable>
              </View>
              {offlineItems.length === 0 ? (
                <Text style={styles.mutedBody}>
                  All offline mutations synced. Queue is empty.
                </Text>
              ) : (
                offlineItems.map((item) => (
                  <View key={item.id} style={styles.traceRow}>
                    <Text style={styles.traceLabel} numberOfLines={1}>
                      {item.operation}
                    </Text>
                    <Text style={styles.traceMeta}>
                      {item.attempts}/{item.maxAttempts} tries
                    </Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>
                Recent Traces (Latest 8)
              </Text>
              {perf.traces.length === 0 ? (
                <Text style={styles.mutedBody}>
                  No traces recorded yet. Navigate across screens to capture
                  timings.
                </Text>
              ) : (
                perf.traces
                  .slice(-8)
                  .reverse()
                  .map((t, idx) => (
                    <View key={`${t.label}-${idx}`} style={styles.traceRow}>
                      <Text style={styles.traceLabel} numberOfLines={1}>
                        {t.label}
                      </Text>
                      <Text style={styles.traceMeta}>
                        {t.durationMs ?? 0}ms · {t.networkRoundTrips} req
                      </Text>
                    </View>
                  ))
              )}
            </View>

            <View style={styles.healthActionsRow}>
              <Pressable
                style={styles.secondaryActionBtn}
                onPress={() => {
                  resetPerfMonitor();
                  void refreshHealth();
                  showToast('Perf traces reset.');
                }}>
                <Text style={styles.secondaryActionText}>Reset Perf</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryActionBtn}
                onPress={handleClearQueryCache}>
                <Text style={styles.secondaryActionText}>Clear Cache</Text>
              </Pressable>
              <Pressable
                style={styles.primaryActionBtn}
                onPress={handleCopyDiagnostics}>
                <Text style={styles.primaryActionText}>Copy Report</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {activeTab === 'JUMP' && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 36, gap: 14 }}>
            {QUICK_JUMP_GROUPS.map((group) => (
              <View key={group.title} style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>{group.title}</Text>
                <View style={{ gap: 8, marginTop: 8 }}>
                  {group.routes.map((route) => (
                    <Pressable
                      key={String(route.path)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.jumpRow,
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => router.push(route.path)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.jumpTitle}>{route.label}</Text>
                        <Text style={styles.jumpSub}>{route.subtitle}</Text>
                      </View>
                      <ExternalLink size={15} color="#64748B" />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  headerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  heroMetric: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  heroMetricSub: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94A3B8',
  },
  rolePill: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#10B981',
  },
  heroFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  heroFooterText: {
    fontSize: 11,
    color: '#CBD5E1',
  },
  composerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 10,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  composerInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
  },
  pillDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 2,
  },
  smallPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  smallPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  smallPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  smallPillTextActive: {
    color: '#FFFFFF',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: OwnerTheme.colors.primary,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 10,
  },
  taskCardDone: {
    opacity: 0.68,
    backgroundColor: '#F8FAFC',
  },
  taskStatusBtn: {
    padding: 2,
  },
  taskBody: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: '#64748B',
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  metaChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  metaChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  areaChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  areaChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  statusLabelText: {
    fontSize: 11,
    color: '#64748B',
    marginLeft: 'auto',
  },
  deleteBtn: {
    padding: 4,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  seedBtn: {
    marginTop: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  seedBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  healthGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  healthStatCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  healthStatValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 6,
  },
  healthStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
  },
  healthStatSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  inlineRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineRefreshText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  mutedBody: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
  traceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  traceLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: '#334155',
  },
  traceMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  healthActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryActionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  primaryActionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    alignItems: 'center',
  },
  primaryActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  jumpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  jumpTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  jumpSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  blockedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  blockedTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  blockedSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
  },
});
