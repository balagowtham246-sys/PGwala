import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

export interface DarkSlateStatItem {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'info' | 'warning' | 'danger';
}

export interface DarkSlateHeroCardProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  badgeLabel?: string;
  badgeTone?: 'info' | 'success' | 'warning' | 'danger';
  stats?: DarkSlateStatItem[];
  style?: StyleProp<ViewStyle>;
}

const VALUE_TONE_COLOR: Record<
  NonNullable<DarkSlateStatItem['tone']>,
  string
> = {
  default: '#FFFFFF',
  success: '#34D399',
  info: '#38BDF8',
  warning: '#FCD34D',
  danger: '#FCA5A5',
};

const BADGE_STYLES: Record<
  NonNullable<DarkSlateHeroCardProps['badgeTone']>,
  { bg: string; border: string; text: string }
> = {
  info: {
    bg: 'rgba(56, 189, 248, 0.16)',
    border: 'rgba(56, 189, 248, 0.35)',
    text: '#38BDF8',
  },
  success: {
    bg: 'rgba(16, 185, 129, 0.18)',
    border: 'rgba(16, 185, 129, 0.38)',
    text: '#34D399',
  },
  warning: {
    bg: 'rgba(251, 191, 36, 0.18)',
    border: 'rgba(251, 191, 36, 0.38)',
    text: '#FCD34D',
  },
  danger: {
    bg: 'rgba(239, 68, 68, 0.2)',
    border: 'rgba(239, 68, 68, 0.42)',
    text: '#FCA5A5',
  },
};

export function DarkSlateHeroCard({
  eyebrow,
  title,
  subtitle,
  badgeLabel,
  badgeTone = 'info',
  stats,
  style,
}: DarkSlateHeroCardProps) {
  const badgeStyle = BADGE_STYLES[badgeTone];

  return (
    <View style={[styles.card, style]}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {badgeLabel ? (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: badgeStyle.bg,
                borderColor: badgeStyle.border,
              },
            ]}>
            <Text style={[styles.badgeText, { color: badgeStyle.text }]}>
              {badgeLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {stats && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map((item, idx) => (
            <React.Fragment key={`${item.label}-${idx}`}>
              {idx > 0 && <View style={styles.statDivider} />}
              <View style={styles.statCol}>
                <Text
                  style={[
                    styles.statValue,
                    { color: VALUE_TONE_COLOR[item.tone ?? 'default'] },
                  ]}
                  numberOfLines={1}>
                  {item.value}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>
                  {item.label}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginTop: 12,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  statValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
  },
});
