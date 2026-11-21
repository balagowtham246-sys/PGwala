import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import * as Sentry from '@sentry/react-native';
import { AlertTriangle, RotateCcw } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
  reloading: boolean;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: null,
      reloading: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
      Sentry.captureException(error, {
        extra: {
          componentStack: errorInfo.componentStack,
        },
      });
    }
    if (__DEV__) {
      console.error('[AppErrorBoundary] Uncaught error:', error, errorInfo);
    }
  }

  handleReloadApp = async (): Promise<void> => {
    if (this.state.reloading) return;
    this.setState({ reloading: true });

    try {
      if (Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled) {
        await Updates.reloadAsync();
        return;
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.reload();
        return;
      }
    } catch {
      // Fall back to resetting React tree state if Updates.reloadAsync is unavailable
    }

    this.setState({
      hasError: false,
      errorMessage: null,
      reloading: false,
    });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <AlertTriangle size={28} color={OwnerTheme.colors.danger} />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              PGwala ran into an unexpected display error. Your PG records and
              account data are safe.
            </Text>
            {__DEV__ && this.state.errorMessage ? (
              <Text style={styles.debugMsg} numberOfLines={4}>
                {this.state.errorMessage}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload App"
              disabled={this.state.reloading}
              style={({ pressed }) => [
                styles.reloadBtn,
                pressed && styles.reloadBtnPressed,
                this.state.reloading && styles.reloadBtnDisabled,
              ]}
              onPress={() => void this.handleReloadApp()}>
              <RotateCcw size={16} color="#FFFFFF" />
              <Text style={styles.reloadBtnText}>
                {this.state.reloading ? 'Reloading...' : 'Reload App'}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 24,
    alignItems: 'center',
    ...OwnerTheme.shadow,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: OwnerTheme.colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: OwnerTheme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  debugMsg: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.dangerLight,
    color: OwnerTheme.colors.danger,
    fontSize: 12,
    width: '100%',
  },
  reloadBtn: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.primary,
    borderRadius: OwnerTheme.radius.md,
    paddingVertical: 13,
    paddingHorizontal: 24,
    width: '100%',
  },
  reloadBtnPressed: {
    opacity: 0.9,
  },
  reloadBtnDisabled: {
    opacity: 0.65,
  },
  reloadBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
