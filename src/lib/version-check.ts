import Constants from 'expo-constants';
import { supabase } from './supabase';

export interface AppVersionConfig {
  id: string;
  platform: string;
  min_version: string;
  latest_version: string;
  apk_download_url: string | null;
  release_notes: string | null;
  is_mandatory: boolean;
}

export interface VersionCheckResult {
  isOutdated: boolean;
  isMandatory: boolean;
  currentVersion: string;
  minVersion: string;
  latestVersion: string;
  apkDownloadUrl: string | null;
  releaseNotes: string | null;
}

/**
 * Compare two semver strings (e.g. "1.0.0" vs "1.0.1").
 * Returns:
 *  -1 if v1 < v2
 *   0 if v1 == v2
 *   1 if v1 > v2
 */
export function compareSemver(v1: string, v2: string): number {
  const parts1 = (v1 || '0').split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = (v2 || '0').split('.').map((p) => parseInt(p, 10) || 0);

  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

/**
 * Retrieves the current installed app version from Expo constants.
 */
export function getAppVersion(): string {
  return Constants.expoConfig?.version || '1.0.0';
}

/**
 * Checks if the installed app version satisfies the minimum and latest requirements.
 * Gracefully defaults to passing if network or table is unavailable.
 */
export async function checkAppVersion(platform: 'android' | 'ios' = 'android'): Promise<VersionCheckResult> {
  const currentVersion = getAppVersion();

  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('platform', platform)
      .maybeSingle();

    if (error || !data) {
      // If table doesn't exist yet or query fails, fail open to avoid locking out users
      return {
        isOutdated: false,
        isMandatory: false,
        currentVersion,
        minVersion: currentVersion,
        latestVersion: currentVersion,
        apkDownloadUrl: null,
        releaseNotes: null,
      };
    }

    const config = data as AppVersionConfig;
    const isBelowMin = compareSemver(currentVersion, config.min_version) < 0;
    const isBelowLatest = compareSemver(currentVersion, config.latest_version) < 0;

    return {
      isOutdated: isBelowMin || (isBelowLatest && config.is_mandatory),
      isMandatory: isBelowMin || config.is_mandatory,
      currentVersion,
      minVersion: config.min_version,
      latestVersion: config.latest_version,
      apkDownloadUrl: config.apk_download_url,
      releaseNotes: config.release_notes,
    };
  } catch {
    return {
      isOutdated: false,
      isMandatory: false,
      currentVersion,
      minVersion: currentVersion,
      latestVersion: currentVersion,
      apkDownloadUrl: null,
      releaseNotes: null,
    };
  }
}

