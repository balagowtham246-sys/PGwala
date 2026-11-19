import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_CREDS_KEY = 'pgwala_biometric_creds';
const BIOMETRIC_ENABLED_KEY = 'pgwala_biometric_enabled';

export interface SavedBiometricCredentials {
  email: string;
  password: string;
}

export interface BiometricAvailability {
  available: boolean;
  label: string;
}

/**
 * Checks whether SecureStore and enrolled device biometrics are available.
 * Uses OS-neutral "Biometrics" label so Android fingerprint / face unlock devices
 * never show iOS-specific "Face ID" wording.
 */
export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  try {
    const storeAvailable = await SecureStore.isAvailableAsync();
    if (!storeAvailable) {
      return { available: false, label: 'Biometrics' };
    }

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { available: false, label: 'Biometrics' };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return { available: false, label: 'Biometrics' };
    }

    return { available: true, label: 'Biometrics' };
  } catch {
    return { available: false, label: 'Biometrics' };
  }
}

export async function isBiometricSignInEnabled(): Promise<boolean> {
  try {
    const storeAvailable = await SecureStore.isAvailableAsync();
    if (!storeAvailable) return false;
    const flag = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return flag === 'true';
  } catch {
    return false;
  }
}

export async function setBiometricSignInEnabled(enabled: boolean): Promise<void> {
  const storeAvailable = await SecureStore.isAvailableAsync();
  if (!storeAvailable) return;
  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_CREDS_KEY);
  }
}

export async function getSavedBiometricCredentials(): Promise<SavedBiometricCredentials | null> {
  try {
    const storeAvailable = await SecureStore.isAvailableAsync();
    if (!storeAvailable) return null;

    const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    if (enabled !== 'true') return null;

    const raw = await SecureStore.getItemAsync(BIOMETRIC_CREDS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SavedBiometricCredentials>;
    if (typeof parsed.email === 'string' && typeof parsed.password === 'string') {
      return { email: parsed.email, password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveBiometricCredentials(email: string, password: string): Promise<void> {
  const storeAvailable = await SecureStore.isAvailableAsync();
  if (!storeAvailable) return;
  await SecureStore.setItemAsync(BIOMETRIC_CREDS_KEY, JSON.stringify({ email, password }));
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
}

export async function clearBiometricCredentials(): Promise<void> {
  try {
    const storeAvailable = await SecureStore.isAvailableAsync();
    if (!storeAvailable) return;
    await SecureStore.deleteItemAsync(BIOMETRIC_CREDS_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
  } catch {
    // Best-effort cleanup
  }
}

export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use Password',
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch {
    return false;
  }
}
