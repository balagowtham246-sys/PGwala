import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { router } from 'expo-router';
import {
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  LucideIcon,
} from 'lucide-react-native';
import { OwnerTheme } from '@/constants/theme';

/* ==========================================================================
   OwnerHeader
   Standard header for all owner screens
   ========================================================================== */
interface OwnerHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  showBack?: boolean;
  rightAction?: React.ReactNode;
  containerStyle?: ViewStyle;
  onSubtitlePress?: () => void;
}

export function OwnerHeader({
  title,
  subtitle,
  onBack,
  showBack = false,
  rightAction,
  containerStyle,
  onSubtitlePress,
}: OwnerHeaderProps) {
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <View style={[styles.headerContainer, containerStyle]}>
      <View style={styles.headerLeft}>
        {showBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
            onPress={handleBack}>
            <ArrowLeft size={20} color={OwnerTheme.colors.textPrimary} />
          </Pressable>
        )}
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            onSubtitlePress ? (
              <Pressable
                hitSlop={8}
                onPress={onSubtitlePress}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
                <Text style={{ fontSize: 10, color: OwnerTheme.colors.primary }}>▾</Text>
              </Pressable>
            ) : (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )
          ) : null}
        </View>
      </View>
      {rightAction && <View style={styles.headerRight}>{rightAction}</View>}
    </View>
  );
}

/* ==========================================================================
   Buttons: Primary, Secondary, Destructive, Text, Icon
   ========================================================================== */
interface BaseButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon: Icon,
  iconPosition = 'left',
  style,
  textStyle,
}: BaseButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.primaryButtonPressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <View style={styles.buttonInner}>
          {Icon && iconPosition === 'left' && (
            <Icon size={18} color="#FFFFFF" style={styles.buttonIconLeft} />
          )}
          <Text style={[styles.primaryButtonText, textStyle]}>{label}</Text>
          {Icon && iconPosition === 'right' && (
            <Icon size={18} color="#FFFFFF" style={styles.buttonIconRight} />
          )}
        </View>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon: Icon,
  iconPosition = 'left',
  style,
  textStyle,
}: BaseButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.secondaryButtonPressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
      ) : (
        <View style={styles.buttonInner}>
          {Icon && iconPosition === 'left' && (
            <Icon
              size={18}
              color={OwnerTheme.colors.primary}
              style={styles.buttonIconLeft}
            />
          )}
          <Text style={[styles.secondaryButtonText, textStyle]}>{label}</Text>
          {Icon && iconPosition === 'right' && (
            <Icon
              size={18}
              color={OwnerTheme.colors.primary}
              style={styles.buttonIconRight}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}

export function DestructiveButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon: Icon,
  style,
  textStyle,
}: BaseButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.destructiveButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.destructiveButtonPressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={OwnerTheme.colors.danger} />
      ) : (
        <View style={styles.buttonInner}>
          {Icon && (
            <Icon
              size={18}
              color={OwnerTheme.colors.danger}
              style={styles.buttonIconLeft}
            />
          )}
          <Text style={[styles.destructiveButtonText, textStyle]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  size = 20,
  color = OwnerTheme.colors.textPrimary,
  style,
  accessibilityLabel,
}: {
  icon: LucideIcon;
  onPress: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.iconButtonPressed,
        style,
      ]}>
      <Icon size={size} color={color} />
    </Pressable>
  );
}

/* ==========================================================================
   StatisticCard
   Clean, compact metric card with semantic accent
   ========================================================================== */
interface StatisticCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  accentColor?: string;
  icon?: LucideIcon;
  onPress?: () => void;
  style?: ViewStyle;
}

export function StatisticCard({
  label,
  value,
  sublabel,
  accentColor = OwnerTheme.colors.primary,
  icon: Icon,
  onPress,
  style,
}: StatisticCardProps) {
  const content = (
    <View style={[styles.statCard, style]}>
      <View style={[styles.statCardAccent, { backgroundColor: accentColor }]} />
      <View style={styles.statCardHeader}>
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
        {Icon && <Icon size={16} color={accentColor} />}
      </View>
      <Text
        style={[styles.statValue, { color: accentColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
      {sublabel ? (
        <Text style={styles.statSublabel} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.statCardPressable,
          pressed && styles.cardPressed,
        ]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

/* ==========================================================================
   StatusBadge
   Semantic status indicator
   ========================================================================== */
export type StatusBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export function StatusBadge({
  label,
  variant = 'neutral',
  size = 'md',
  style,
}: StatusBadgeProps) {
  const config = {
    success: {
      bg: OwnerTheme.colors.successLight,
      text: OwnerTheme.colors.success,
      dot: OwnerTheme.colors.success,
    },
    warning: {
      bg: OwnerTheme.colors.warningLight,
      text: OwnerTheme.colors.warning,
      dot: OwnerTheme.colors.warning,
    },
    danger: {
      bg: OwnerTheme.colors.dangerLight,
      text: OwnerTheme.colors.danger,
      dot: OwnerTheme.colors.danger,
    },
    info: {
      bg: OwnerTheme.colors.primaryLight,
      text: OwnerTheme.colors.primary,
      dot: OwnerTheme.colors.primary,
    },
    neutral: {
      bg: '#F1F5F9',
      text: '#475569',
      dot: '#94A3B8',
    },
  }[variant];

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: config.bg },
        isSmall && styles.badgeSm,
        style,
      ]}>
      <View
        style={[
          styles.badgeDot,
          { backgroundColor: config.dot },
          isSmall && styles.badgeDotSm,
        ]}
      />
      <Text
        style={[
          styles.badgeText,
          { color: config.text },
          isSmall && styles.badgeTextSm,
        ]}>
        {label}
      </Text>
    </View>
  );
}

/* ==========================================================================
   SegmentedFilter
   Accessible, modern tab switcher
   ========================================================================== */
export interface SegmentOption<T extends string = string> {
  key: T;
  label: string;
  count?: number;
}

interface SegmentedFilterProps<T extends string = string> {
  options: SegmentOption<T>[];
  activeKey: T;
  onSelect: (key: T) => void;
  style?: ViewStyle;
}

export function SegmentedFilter<T extends string = string>({
  options,
  activeKey,
  onSelect,
  style,
}: SegmentedFilterProps<T>) {
  return (
    <View style={[styles.filterContainer, style]}>
      {options.map((opt) => {
        const isActive = opt.key === activeKey;
        return (
          <Pressable
            key={opt.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={[styles.filterTab, isActive && styles.filterTabActive]}
            onPress={() => onSelect(opt.key)}>
            <Text
              style={[
                styles.filterTabText,
                isActive && styles.filterTabTextActive,
              ]}>
              {opt.label}
              {typeof opt.count === 'number' ? ` (${opt.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ==========================================================================
   SectionHeader
   Consistent section title & action row
   ========================================================================== */
interface SectionHeaderProps {
  title: string;
  meta?: string;
  actionText?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function SectionHeader({
  title,
  meta,
  actionText,
  onAction,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.sectionRow, style]}>
      <View style={styles.sectionTitleWrap}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
      </View>
      {actionText && onAction && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAction}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
          <Text style={styles.sectionActionText}>{actionText}</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ==========================================================================
   Loading, Empty & Error States
   ========================================================================== */
export function LoadingState({
  message = 'Loading...',
  style,
}: {
  message?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.centerState, style]}>
      <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
      <Text style={styles.loadingMessage}>{message}</Text>
    </View>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  style,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.centerState, styles.emptyBox, style]}>
      {Icon && (
        <View style={styles.emptyIconCircle}>
          <Icon size={24} color={OwnerTheme.colors.textSecondary} />
        </View>
      )}
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? (
        <Text style={styles.emptyDescription}>{description}</Text>
      ) : null}
      {actionLabel && onAction && (
        <View style={styles.emptyActionRow}>
          <SecondaryButton label={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  style,
}: {
  message: string;
  onRetry?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.errorContainer, style]}>
      <AlertCircle
        size={18}
        color={OwnerTheme.colors.danger}
        style={{ marginRight: 8, marginTop: 1 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.errorText}>{message}</Text>
      </View>
      {onRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          hitSlop={8}
          onPress={onRetry}
          style={styles.retryBtn}>
          <RefreshCw size={14} color={OwnerTheme.colors.danger} />
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ==========================================================================
   Styles
   ========================================================================== */
const styles = StyleSheet.create({
  // Header
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: OwnerTheme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    ...OwnerTheme.typography.screenHeading,
    fontSize: 22,
    color: OwnerTheme.colors.textPrimary,
  },
  headerSubtitle: {
    ...OwnerTheme.typography.supporting,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },

  // Buttons
  primaryButton: {
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  primaryButtonPressed: {
    backgroundColor: OwnerTheme.colors.primaryDark,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  secondaryButton: {
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  secondaryButtonPressed: {
    backgroundColor: '#F8FAFC',
    borderColor: OwnerTheme.colors.primary,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  destructiveButton: {
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.dangerLight,
    borderWidth: 1,
    borderColor: '#FECACA',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  destructiveButtonPressed: {
    backgroundColor: '#FEE2E2',
    opacity: 0.85,
  },
  destructiveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.danger,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIconLeft: {
    marginRight: 8,
  },
  buttonIconRight: {
    marginLeft: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonPressed: {
    backgroundColor: '#F1F5F9',
  },

  // Stat Card
  statCardPressable: {
    flex: 1,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  statCard: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 88,
    justifyContent: 'center',
  },
  statCardAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
    flex: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginVertical: 2,
  },
  statSublabel: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    fontWeight: '500',
  },

  // Badges
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: OwnerTheme.radius.full,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  badgeDotSm: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  badgeTextSm: {
    fontSize: 11,
  },

  // Segmented Filter
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: '#EBEFF5',
    borderRadius: OwnerTheme.radius.md,
    padding: 3,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: OwnerTheme.radius.sm,
  },
  filterTabActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  filterTabTextActive: {
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },

  // Section Header
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flex: 1,
  },
  sectionTitle: {
    ...OwnerTheme.typography.sectionHeading,
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textMuted,
  },
  sectionActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },

  // States
  centerState: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingMessage: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  emptyBox: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 24,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  emptyDescription: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  emptyActionRow: {
    marginTop: 14,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.dangerLight,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginVertical: 8,
  },
  errorText: {
    fontSize: 13,
    color: OwnerTheme.colors.danger,
    fontWeight: '500',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#FFFFFF',
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.danger,
  },
});

