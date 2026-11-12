jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.0.0',
  },
}));

import { compareSemver, getAppVersion } from '../version-check';

describe('compareSemver', () => {
  it('correctly compares equal versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.1.3', '2.1.3')).toBe(0);
  });

  it('correctly identifies older versions', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSemver('1.9.9', '2.0.0')).toBe(-1);
    expect(compareSemver('0.9.0', '1.0.0')).toBe(-1);
  });

  it('correctly identifies newer versions', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
    expect(compareSemver('1.1.0', '1.0.5')).toBe(1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('handles mismatched segment lengths gracefully', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.1', '1.0')).toBe(1);
    expect(compareSemver('1.0', '1.0.1')).toBe(-1);
  });

  it('handles invalid or empty strings gracefully without crashing', () => {
    expect(compareSemver('', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '')).toBe(1);
  });
});

describe('getAppVersion', () => {
  it('returns the configured Expo version', () => {
    expect(getAppVersion()).toBe('1.0.0');
  });
});
