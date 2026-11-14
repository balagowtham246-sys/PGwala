import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_CREDS_KEY = 'pgwala_biometric_creds';

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

    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return { available: true, label: 'Face ID' };
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return { available: true, label: 'Fingerprint' };
    }
    return { available: true, label: 'Biometrics' };
  } catch {
    return { available: false, label: 'Biometrics' };
  }
}

export async function getSavedBiometricCredentials(): Promise<SavedBiometricCredentials | null> {
  try {
    const storeAvailable = await SecureStore.isAvailableAsync();
    if (!storeAvailable) return null;

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
}

export async function clearBiometricCredentials(): Promise<void> {
  try {
    const storeAvailable = await SecureStore.isAvailableAsync();
    if (!storeAvailable) return;
    await SecureStore.deleteItemAsync(BIOMETRIC_CREDS_KEY);
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
