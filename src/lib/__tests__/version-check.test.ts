import {
  compareSemver,
  getAppVersion,
  resolveUpdateGuardMode,
} from '../version-check';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.0.0',
  },
}));

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

describe('resolveUpdateGuardMode (expo-updates + native UpdateGuard compatibility)', () => {
  const baseVersion = {
    isOutdated: false,
    isMandatory: false,
    currentVersion: '1.0.0',
    minVersion: '1.0.0',
    latestVersion: '1.0.0',
    apkDownloadUrl: null,
    releaseNotes: null,
  };

  it('prioritizes mandatory_native over ota_ready even when dismissed', () => {
    expect(
      resolveUpdateGuardMode({
        versionResult: { ...baseVersion, isOutdated: true, isMandatory: true },
        otaReady: true,
        dismissed: true,
      })
    ).toBe('mandatory_native');
  });

  it('shows ota_ready when an OTA bundle is fetched and no mandatory native upgrade blocks it', () => {
    expect(
      resolveUpdateGuardMode({
        versionResult: { ...baseVersion, isOutdated: true, isMandatory: false },
        otaReady: true,
        dismissed: false,
      })
    ).toBe('ota_ready');
  });

  it('falls back to optional_native when outdated non-mandatory and no OTA is ready', () => {
    expect(
      resolveUpdateGuardMode({
        versionResult: { ...baseVersion, isOutdated: true, isMandatory: false },
        otaReady: false,
        dismissed: false,
      })
    ).toBe('optional_native');
  });

  it('returns none when dismissed or up to date', () => {
    expect(
      resolveUpdateGuardMode({
        versionResult: baseVersion,
        otaReady: false,
        dismissed: false,
      })
    ).toBe('none');
    expect(
      resolveUpdateGuardMode({
        versionResult: { ...baseVersion, isOutdated: true, isMandatory: false },
        otaReady: true,
        dismissed: true,
      })
    ).toBe('none');
  });
});
