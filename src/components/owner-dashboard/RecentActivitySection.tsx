import { Href, router } from 'expo-router';
import { LogIn, LogOut } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, SectionHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useResidentTabs } from '@/context/resident-tabs-context';
import { formatRoomLabel, toSentenceCaseStatus } from '@/lib/ux-utils';
import type { OwnerActivityItem } from '@/services/dashboard.service';

interface RecentActivitySectionProps {
  loading: boolean;
  activities: OwnerActivityItem[];
}

export function RecentActivitySection({ loading, activities }: RecentActivitySectionProps) {
  const { isInsidePager, navigateToTab } = useResidentTabs();
  const visibleActivities = activities.slice(0, 4);

  return (
    <View>
      {/* Priority Area 4: Recent Gate Movements */}
      <SectionHeader
        title="Recent Movement"
        actionText="View all ›"
        onAction={() => {
          if (isInsidePager) {
            navigateToTab('gate');
          } else {
            router.push('/resident-in-out');
          }
        }}
        style={{ marginTop: 4, marginBottom: 8 }}
      />

      <View style={styles.activityCard}>
        {loading ? (
          <View style={styles.activityLoading}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
          </View>
        ) : visibleActivities.length === 0 ? (
          <EmptyState
            title="No recent movements"
            description="Resident gate check-ins and check-outs will display here."
          />
        ) : (
          visibleActivities.map((item, index) => {
            const isEntry = item.direction === 'IN';
            const statusLabel = toSentenceCaseStatus(item.direction);
            const actionLabel = isEntry ? 'Checked in' : 'Checked out';
            const roomLabel = item.roomNumber?.trim()
              ? formatRoomLabel(item.roomNumber)
              : '';

            const rowContent = (
              <>
                <View
                  style={[
                    styles.activityIconCircle,
                    {
                      backgroundColor: isEntry
                        ? OwnerTheme.colors.successLight
                        : OwnerTheme.colors.warningLight,
                    },
                  ]}>
                  {isEntry ? (
                    <LogIn size={14} color={OwnerTheme.colors.success} />
                  ) : (
                    <LogOut size={14} color={OwnerTheme.colors.warning} />
                  )}
                </View>
                <View style={styles.activityDetails}>
                  <Text style={styles.activityResidentName}>
                    {item.residentName}
                    {roomLabel ? ` (${roomLabel})` : ''}
                  </Text>
                  <Text style={styles.activityActionText}>
                    {actionLabel}
                    {item.purpose ? ` · ${item.purpose}` : ''}
                  </Text>
                </View>
                <View style={styles.activityRight}>
                  <View
                    style={[
                      styles.directionPill,
                      isEntry ? styles.directionPillIn : styles.directionPillOut,
                    ]}>
                    <Text
                      style={[
                        styles.directionPillText,
                        isEntry ? styles.directionTextIn : styles.directionTextOut,
                      ]}>
                      {statusLabel}
                    </Text>
                  </View>
                  <Text style={styles.activityTimeText}>{item.time}</Text>
                </View>
              </>
            );

            if (item.residentId) {
              const targetResidentId = item.residentId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View profile for ${item.residentName}`}
                  style={({ pressed }) => [
                    styles.activityRow,
                    index === visibleActivities.length - 1 && styles.activityRowLast,
                    pressed && styles.activityRowPressed,
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: '/resident-profile',
                      params: { id: targetResidentId },
                    } as Href)
                  }>
                  {rowContent}
                </Pressable>
              );
            }

            return (
              <View
                key={item.id}
                style={[
                  styles.activityRow,
                  index === visibleActivities.length - 1 && styles.activityRowLast,
                ]}>
                {rowContent}
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 2,
    ...OwnerTheme.shadow,
  },
  activityLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 8,
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityRowPressed: {
    opacity: 0.72,
  },
  activityIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityDetails: {
    flex: 1,
    minWidth: 0,
  },
  activityResidentName: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  activityActionText: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  activityRight: {
    alignItems: 'flex-end',
    gap: 3,
    flexShrink: 0,
  },
  directionPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
  },
  directionPillIn: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  directionPillOut: {
    backgroundColor: OwnerTheme.colors.warningLight,
  },
  directionPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  directionTextIn: {
    color: OwnerTheme.colors.success,
  },
  directionTextOut: {
    color: '#B45309',
  },
  activityTimeText: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
});
