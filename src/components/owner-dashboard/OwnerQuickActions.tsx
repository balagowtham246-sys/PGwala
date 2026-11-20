import { Href, router } from 'expo-router';
import { Megaphone, Users } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OwnerTheme } from '@/constants/theme';

interface OwnerQuickActionsProps {
  totalResidents: number;
  studentsInside: number;
  unpaidResidentsCount?: number;
  totalBeds?: number;
  rentCollectedPaise?: number;
  rentTotalPaise?: number;
}

export function OwnerQuickActions({
  totalResidents,
  studentsInside,
  unpaidResidentsCount = 0,
  totalBeds = 0,
  rentCollectedPaise = 0,
  rentTotalPaise = 0,
}: OwnerQuickActionsProps) {
  const bedOccupancyLabel =
    totalBeds > 0 ? `${totalResidents}/${totalBeds} beds` : `${totalResidents} beds`;
  const collectionPct =
    rentTotalPaise > 0 ? Math.round((rentCollectedPaise / rentTotalPaise) * 100) : null;
  const collectionRateLabel =
    collectionPct !== null ? `${collectionPct}% rent paid` : null;
  const isHealthyCollection = collectionPct !== null && collectionPct >= 80;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View residents directory"
        style={({ pressed }) => [styles.actionCard, pressed && styles.cardPressed]}
        onPress={() => router.push('/residents-directory' as Href)}>
        <View style={styles.iconWrap}>
          <Users size={18} color={OwnerTheme.colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Residents</Text>
          <Text style={styles.subtitle}>
            {`${totalResidents} active · ${studentsInside} inside · ${unpaidResidentsCount} with dues`}
          </Text>
        </View>
        <View style={styles.insightsCol}>
          <View style={styles.bedInsightBadge}>
            <Text style={styles.bedInsightText}>{bedOccupancyLabel}</Text>
          </View>
          {collectionRateLabel !== null && (
            <View
              style={[
                styles.collectionInsightBadge,
                isHealthyCollection
                  ? styles.collectionInsightHealthy
                  : styles.collectionInsightPending,
              ]}>
              <Text
                style={[
                  styles.collectionInsightText,
                  isHealthyCollection
                    ? styles.collectionTextHealthy
                    : styles.collectionTextPending,
                ]}>
                {collectionRateLabel}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send announcement to residents"
        style={({ pressed }) => [styles.actionCard, pressed && styles.cardPressed]}
        onPress={() => router.push('/owner-announcements' as Href)}>
        <View style={styles.iconWrap}>
          <Megaphone size={18} color={OwnerTheme.colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Announcements</Text>
          <Text style={styles.subtitle}>
            Send notice to all residents or one room (Push / WhatsApp)
          </Text>
        </View>
        <Text style={styles.ctaText}>Send ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    ...OwnerTheme.shadow,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  insightsCol: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  bedInsightBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  bedInsightText: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  collectionInsightBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
  },
  collectionInsightHealthy: {
    backgroundColor: OwnerTheme.colors.successLight,
    borderColor: '#BBF7D0',
  },
  collectionInsightPending: {
    backgroundColor: OwnerTheme.colors.warningLight,
    borderColor: '#FDE68A',
  },
  collectionInsightText: {
    fontSize: 11,
    fontWeight: '700',
  },
  collectionTextHealthy: {
    color: '#15803D',
  },
  collectionTextPending: {
    color: '#B45309',
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    flexShrink: 0,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
