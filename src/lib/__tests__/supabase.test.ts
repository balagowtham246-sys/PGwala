jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import {
  decodeBase64ToBytes,
  getSignedComplaintPhotoUrl,
  getSignedPaymentProofUrl,
  supabase,
} from '../supabase';

describe('getSignedPaymentProofUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for null, undefined, or empty string', async () => {
    expect(await getSignedPaymentProofUrl(null)).toBeNull();
    expect(await getSignedPaymentProofUrl(undefined)).toBeNull();
    expect(await getSignedPaymentProofUrl('   ')).toBeNull();
  });

  it('returns existing signed URLs as-is without re-signing', async () => {
    const existingSigned =
      'https://xyz.supabase.co/storage/v1/object/sign/payment-proofs/pic.jpg?token=abc12345';
    expect(await getSignedPaymentProofUrl(existingSigned)).toBe(existingSigned);
  });

  it('returns local device URIs as-is without attempting storage signing', async () => {
    expect(await getSignedPaymentProofUrl('file:///var/mobile/img.png')).toBe(
      'file:///var/mobile/img.png'
    );
    expect(await getSignedPaymentProofUrl('ph://gallery/123')).toBe(
      'ph://gallery/123'
    );
    expect(await getSignedPaymentProofUrl('content://media/external/1')).toBe(
      'content://media/external/1'
    );
  });

  it('creates signed URL from a clean relative path', async () => {
    const mockCreateSignedUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl:
          'https://xyz.supabase.co/storage/v1/object/sign/payment-proofs/res123/receipt.jpg?token=sec',
      },
      error: null,
    });

    jest.spyOn(supabase.storage, 'from').mockReturnValue({
      createSignedUrl: mockCreateSignedUrl,
    } as any);

    const result = await getSignedPaymentProofUrl('res123/receipt.jpg', 1800);

    expect(supabase.storage.from).toHaveBeenCalledWith('payment-proofs');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('res123/receipt.jpg', 1800);
    expect(result).toBe(
      'https://xyz.supabase.co/storage/v1/object/sign/payment-proofs/res123/receipt.jpg?token=sec'
    );
  });

  it('extracts relative path from legacy public Supabase URLs and signs it', async () => {
    const mockCreateSignedUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl:
          'https://xyz.supabase.co/storage/v1/object/sign/payment-proofs/sub/old.jpg?token=new',
      },
      error: null,
    });

    jest.spyOn(supabase.storage, 'from').mockReturnValue({
      createSignedUrl: mockCreateSignedUrl,
    } as any);

    const legacyPublicUrl =
      'https://xyz.supabase.co/storage/v1/object/public/payment-proofs/sub/old.jpg';
    const result = await getSignedPaymentProofUrl(legacyPublicUrl);

    expect(mockCreateSignedUrl).toHaveBeenCalledWith('sub/old.jpg', 3600);
    expect(result).toBe(
      'https://xyz.supabase.co/storage/v1/object/sign/payment-proofs/sub/old.jpg?token=new'
    );
  });
});

describe('getSignedComplaintPhotoUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('signs complaint-photos path using complaint-photos storage bucket', async () => {
    const mockCreateSignedUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl:
          'https://xyz.supabase.co/storage/v1/object/sign/complaint-photos/resident1/leak.jpg?token=secret',
      },
      error: null,
    });

    jest.spyOn(supabase.storage, 'from').mockReturnValue({
      createSignedUrl: mockCreateSignedUrl,
    } as any);

    const result = await getSignedComplaintPhotoUrl('resident1/leak.jpg', 3600);

    expect(supabase.storage.from).toHaveBeenCalledWith('complaint-photos');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('resident1/leak.jpg', 3600);
    expect(result).toBe(
      'https://xyz.supabase.co/storage/v1/object/sign/complaint-photos/resident1/leak.jpg?token=secret'
    );
  });
});

describe('decodeBase64ToBytes', () => {
  it('correctly converts base64 encoded text to bytes', () => {
    // "Hello World" in base64 is "SGVsbG8gV29ybGQ="
    const bytes = decodeBase64ToBytes('SGVsbG8gV29ybGQ=');
    const text = String.fromCharCode(...bytes);
    expect(text).toBe('Hello World');
  });

  it('handles empty string gracefully', () => {
    const bytes = decodeBase64ToBytes('');
    expect(bytes.length).toBe(0);
  });
});
