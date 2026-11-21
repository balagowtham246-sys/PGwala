import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const DURATION = 600;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
      setVisible(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const brandContent = (
    <View style={styles.brandStack}>
      <View style={styles.appIconFrame}>
        <Image style={styles.appIcon} source={require('@/assets/images/icon.png')} />
      </View>
      <Text style={styles.brandTitle}>PGwala</Text>
      <Text style={styles.brandTagline}>Smart PG Living</Text>
    </View>
  );

  return animate ? (
    <Animated.View
      pointerEvents="none"
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}>
      {brandContent}
    </Animated.View>
  ) : (
    <View
      pointerEvents="none"
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}>
      {brandContent}
    </View>
  );
}

const styles = StyleSheet.create({
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#F5F7FA',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  brandStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIconFrame: {
    width: 96,
    height: 96,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
    marginBottom: 16,
  },
  appIcon: {
    width: 96,
    height: 96,
  },
  brandTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 4,
  },
});
