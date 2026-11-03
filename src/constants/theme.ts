/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * PGwala 2.0 Modern Owner Design Tokens
 * Follows Airbnb Host / Stripe Dashboard / Material 3 guidelines
 */
export const OwnerTheme = {
  colors: {
    primary: '#087FAF',
    primaryDark: '#075B80',
    primaryLight: '#E6F4FA',
    success: '#168653',
    successLight: '#DCFCE7',
    warning: '#D97706',
    warningLight: '#FEF3C7',
    danger: '#DC3545',
    dangerLight: '#FEE2E2',
    background: '#F5F7FA',
    card: '#FFFFFF',
    textPrimary: '#172033',
    textSecondary: '#697586',
    textMuted: '#94A3B8',
    border: '#E1E6EC',
    borderLight: '#EDF1F5',
  },
  typography: {
    screenHeading: {
      fontSize: 26,
      fontWeight: '700' as const,
      color: '#172033',
      letterSpacing: -0.5,
    },
    sectionHeading: {
      fontSize: 18,
      fontWeight: '600' as const,
      color: '#172033',
      letterSpacing: -0.2,
    },
    cardHeading: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: '#172033',
    },
    body: {
      fontSize: 14,
      fontWeight: '400' as const,
      color: '#172033',
    },
    supporting: {
      fontSize: 12,
      fontWeight: '400' as const,
      color: '#697586',
    },
  },
  radius: {
    sm: 8,
    md: 12,
    card: 16,
    lg: 20,
    full: 9999,
  },
  shadow: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
    },
    android: {
      elevation: 2,
    },
    default: {
      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
    },
  }),
} as const;

