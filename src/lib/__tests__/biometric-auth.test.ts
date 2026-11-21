import {
  clearBiometricCredentials,
  getBiometricAvailability,
  getSavedBiometricCredentials,
  isBiometricSignInEnabled,
  saveBiometricCredentials,
  setBiometricSignInEnabled,
} from '../biometric-auth';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, val: string) => {
    mockStore.set(key, val);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));

describe('biometric-auth', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('uses OS-neutral Biometrics label when available', async () => {
    const avail = await getBiometricAvailability();
    expect(avail).toEqual({ available: true, label: 'Biometrics' });
  });

  it('only returns saved credentials when biometric sign-in is enabled', async () => {
    expect(await isBiometricSignInEnabled()).toBe(false);
    expect(await getSavedBiometricCredentials()).toBeNull();

    await saveBiometricCredentials('resident@pg.in', 'secret123');
    expect(await isBiometricSignInEnabled()).toBe(true);
    expect(await getSavedBiometricCredentials()).toEqual({
      email: 'resident@pg.in',
      password: 'secret123',
    });

    await setBiometricSignInEnabled(false);
    expect(await isBiometricSignInEnabled()).toBe(false);
    expect(await getSavedBiometricCredentials()).toBeNull();
  });

  it('clears both enabled flag and credentials on clearBiometricCredentials', async () => {
    await saveBiometricCredentials('resident@pg.in', 'secret123');
    await clearBiometricCredentials();
    expect(await isBiometricSignInEnabled()).toBe(false);
    expect(await getSavedBiometricCredentials()).toBeNull();
  });
});
