import {
  compressPickedImage,
  estimateBase64ByteLength,
  uploadStorageWithRetry,
} from '../image-upload';

const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn();
const mockResize = jest.fn();
const mockManipulate = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: (...args: unknown[]) => mockManipulate(...args),
  },
}));

const mockStorageUpload = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: (...args: unknown[]) => mockStorageUpload(...args),
      })),
    },
  },
}));

describe('image-upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResize.mockReturnThis();
    mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
    mockManipulate.mockReturnValue({
      resize: mockResize,
      renderAsync: mockRenderAsync,
    });
  });

  it('estimates decoded byte length from base64 strings accurately', () => {
    expect(estimateBase64ByteLength('')).toBe(0);
    // "ABCD" base64 is "QUJDRA==" (8 chars, 2 pad -> 4 bytes)
    expect(estimateBase64ByteLength('QUJDRA==')).toBe(4);
    expect(estimateBase64ByteLength('AQID')).toBe(3);
  });

  it('downscales oversized photos and returns compressed JPEG base64 within maxBytes', async () => {
    mockSaveAsync.mockResolvedValueOnce({
      uri: 'file:///tmp/compressed.jpg',
      base64: 'AQID', // 3 bytes
      width: 1280,
      height: 720,
    });

    const outcome = await compressPickedImage(
      { uri: 'file:///tmp/camera.jpg', width: 4000, height: 2250 },
      { maxDimension: 1280, quality: 0.72, maxBytes: 1024 }
    );

    expect(mockManipulate).toHaveBeenCalledWith('file:///tmp/camera.jpg');
    expect(mockResize).toHaveBeenCalledWith({ width: 1280 });
    expect(outcome).toEqual({
      ok: true,
      data: {
        uri: 'file:///tmp/compressed.jpg',
        base64: 'AQID',
        byteLength: 3,
        width: 1280,
        height: 720,
        compressed: true,
      },
    });
  });

  it('rejects images that still exceed maxBytes after two compression passes', async () => {
    const oversizedBase64 = 'A'.repeat(400); // ~300 bytes
    mockSaveAsync
      .mockResolvedValueOnce({
        uri: 'file:///tmp/p1.jpg',
        base64: oversizedBase64,
        width: 1280,
        height: 960,
      })
      .mockResolvedValueOnce({
        uri: 'file:///tmp/p2.jpg',
        base64: oversizedBase64,
        width: 800,
        height: 600,
      });

    const outcome = await compressPickedImage(
      { uri: 'file:///tmp/huge.png', width: 5000, height: 3750 },
      { maxBytes: 100 }
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('exceeds');
    }
  });

  it('retries storage uploads on transient network errors and stops immediately on 4xx errors', async () => {
    const stages: string[] = [];
    mockStorageUpload
      .mockResolvedValueOnce({ error: { message: 'Network request failed' } })
      .mockResolvedValueOnce({ error: null });

    const okRes = await uploadStorageWithRetry({
      bucket: 'complaint-photos',
      path: 'res-1/photo.jpg',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      maxAttempts: 2,
      onProgress: (stage) => stages.push(stage),
    });

    expect(okRes.error).toBeNull();
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(mockStorageUpload.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
    expect((mockStorageUpload.mock.calls[0][1] as ArrayBuffer).byteLength).toBe(3);
    expect(stages).toEqual(['uploading', 'retrying', 'done']);

    mockStorageUpload.mockClear();
    mockStorageUpload.mockResolvedValueOnce({
      error: { message: 'new row violates row-level security policy', statusCode: 403 },
    });

    const deniedRes = await uploadStorageWithRetry({
      bucket: 'payment-proofs',
      path: 'res-1/proof.jpg',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      maxAttempts: 2,
    });

    expect(deniedRes.error?.message).toContain('row-level security');
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
  });
});
