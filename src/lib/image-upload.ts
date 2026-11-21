import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { extractErrorMessage } from '@/lib/error-utils';
import { isLikelyNetworkError } from '@/lib/service-result';
import {
  supabase,
  supabasePublishableKey,
  supabaseUrl,
} from '@/lib/supabase';

export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB hard limit after compression
export const DEFAULT_MAX_IMAGE_DIMENSION = 1280;
export const DEFAULT_IMAGE_QUALITY = 0.72;

export interface PickedImageAssetInput {
  uri: string;
  width?: number;
  height?: number;
  base64?: string | null;
}

export interface CompressedImageResult {
  uri: string;
  base64: string;
  byteLength: number;
  width?: number;
  height?: number;
  compressed: boolean;
}

export type ImageCompressOutcome =
  | { ok: true; data: CompressedImageResult }
  | { ok: false; error: string };

/**
 * Estimates decoded byte length from a raw base64 string (without data URL prefix).
 */
export function estimateBase64ByteLength(base64: string): number {
  const clean = base64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!clean) return 0;
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

async function runSingleCompressionPass(
  asset: PickedImageAssetInput,
  maxDimension: number,
  quality: number
): Promise<{
  uri: string;
  base64: string;
  width?: number;
  height?: number;
} | null> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const srcW = asset.width ?? 0;
  const srcH = asset.height ?? 0;

  if (srcW > maxDimension || srcH > maxDimension) {
    if (srcW >= srcH) {
      ctx.resize({ width: maxDimension });
    } else {
      ctx.resize({ height: maxDimension });
    }
  } else if (srcW === 0 && srcH === 0) {
    // Unknown source dimensions (e.g. content:// URI): safely cap width at maxDimension
    ctx.resize({ width: maxDimension });
  }

  const imageRef = await ctx.renderAsync();
  const saved = await imageRef.saveAsync({
    compress: quality,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!saved.base64) return null;
  return {
    uri: saved.uri,
    base64: saved.base64,
    width: saved.width,
    height: saved.height,
  };
}

/**
 * Compresses & downscales a camera or gallery image on the native thread using
 * `expo-image-manipulator` and enforces `maxBytes` (default 2 MB).
 */
export async function compressPickedImage(
  asset: PickedImageAssetInput,
  options?: {
    maxDimension?: number;
    quality?: number;
    maxBytes?: number;
  }
): Promise<ImageCompressOutcome> {
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
  const quality = options?.quality ?? DEFAULT_IMAGE_QUALITY;
  const maxBytes = options?.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES;

  try {
    const pass1 = await runSingleCompressionPass(asset, maxDimension, quality);
    if (pass1) {
      const size1 = estimateBase64ByteLength(pass1.base64);
      if (size1 > 0 && size1 <= maxBytes) {
        return {
          ok: true,
          data: {
            uri: pass1.uri,
            base64: pass1.base64,
            byteLength: size1,
            width: pass1.width,
            height: pass1.height,
            compressed: true,
          },
        };
      }

      // Second aggressive pass if still over maxBytes
      const pass2 = await runSingleCompressionPass(
        { uri: pass1.uri, width: pass1.width, height: pass1.height },
        Math.min(800, maxDimension),
        Math.min(0.5, quality)
      );
      if (pass2) {
        const size2 = estimateBase64ByteLength(pass2.base64);
        if (size2 > 0 && size2 <= maxBytes) {
          return {
            ok: true,
            data: {
              uri: pass2.uri,
              base64: pass2.base64,
              byteLength: size2,
              width: pass2.width,
              height: pass2.height,
              compressed: true,
            },
          };
        }
      }

      return {
        ok: false,
        error: `Selected image exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)} MB even after compression. Please choose a smaller image.`,
      };
    }
  } catch {
    // Fallback to raw base64 only if supplied and within maxBytes
  }

  if (asset.base64) {
    const rawSize = estimateBase64ByteLength(asset.base64);
    if (rawSize > maxBytes) {
      return {
        ok: false,
        error: `Selected image is too large (${(rawSize / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is ${(maxBytes / (1024 * 1024)).toFixed(0)} MB.`,
      };
    }
    return {
      ok: true,
      data: {
        uri: asset.uri,
        base64: asset.base64,
        byteLength: rawSize,
        width: asset.width,
        height: asset.height,
        compressed: false,
      },
    };
  }

  return {
    ok: false,
    error: 'Could not prepare the selected image. Please try another photo.',
  };
}

export type UploadStage = 'uploading' | 'retrying' | 'done';

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

async function uploadViaNativeFileSystem(params: {
  bucket: string;
  path: string;
  fileUri: string;
  contentType: string;
  upsert: boolean;
}): Promise<{ handled: boolean; error: Error | null }> {
  if (Platform.OS === 'web' || !params.fileUri || !supabase.auth?.getSession) {
    return { handled: false, error: null };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken || !supabaseUrl || supabaseUrl.includes('placeholder.supabase.co')) {
    return { handled: false, error: null };
  }

  const cleanPath = params.path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(params.bucket)}/${cleanPath}`;

  const response = await FileSystem.uploadAsync(endpoint, params.fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabasePublishableKey,
      'Content-Type': params.contentType,
      'x-upsert': String(params.upsert),
      'cache-control': '3600',
    },
  });

  if (response.status >= 200 && response.status < 300) {
    return { handled: true, error: null };
  }

  let errMsg = `Storage upload failed (HTTP ${response.status})`;
  try {
    const json = JSON.parse(response.body) as { message?: string; error?: string };
    errMsg = json.message || json.error || errMsg;
  } catch {
    // Keep HTTP status message
  }
  const err = new Error(errMsg) as Error & { status?: number };
  err.status = response.status;
  return { handled: true, error: err };
}

/**
 * Uploads binary image bytes (using native FormData file-URI streaming on mobile
 * when `fileUri` is provided, falling back to an exact ArrayBuffer) to Supabase
 * Storage with automatic retry on transient network errors and no retry on 4xx/RLS errors.
 */
export async function uploadStorageWithRetry(params: {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  fileUri?: string;
  contentType: string;
  upsert?: boolean;
  maxAttempts?: number;
  onProgress?: (stage: UploadStage, attempt: number) => void;
}): Promise<{ error: Error | null }> {
  const maxAttempts = Math.max(1, params.maxAttempts ?? 2);
  const uploadBody = toExactArrayBuffer(params.bytes);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    params.onProgress?.(attempt === 1 ? 'uploading' : 'retrying', attempt);
    try {
      let uploadResultError: {
        message?: string;
        status?: number;
        statusCode?: string | number;
      } | null = null;

      if (params.fileUri) {
        const nativeRes = await uploadViaNativeFileSystem({
          bucket: params.bucket,
          path: params.path,
          fileUri: params.fileUri,
          contentType: params.contentType,
          upsert: params.upsert ?? false,
        });
        if (nativeRes.handled) {
          if (!nativeRes.error) {
            params.onProgress?.('done', attempt);
            return { error: null };
          }
          uploadResultError = nativeRes.error;
        }
      }

      if (!uploadResultError) {
        const { error } = await supabase.storage
          .from(params.bucket)
          .upload(params.path, uploadBody, {
            contentType: params.contentType,
            upsert: params.upsert ?? false,
          });
        if (!error) {
          params.onProgress?.('done', attempt);
          return { error: null };
        }
        uploadResultError = error;
      }

      const wrapped = new Error(uploadResultError.message || 'Storage upload failed.');
      lastError = wrapped;

      const rawStatus = uploadResultError.status ?? uploadResultError.statusCode;
      const status = typeof rawStatus === 'string' ? Number(rawStatus) : rawStatus;
      if (typeof status === 'number' && !Number.isNaN(status) && status >= 400 && status < 500) {
        return { error: wrapped };
      }

      if (!isLikelyNetworkError(uploadResultError) || attempt === maxAttempts) {
        return { error: wrapped };
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Storage upload failed.');
      lastError = new Error(msg);
      if (!isLikelyNetworkError(err) || attempt === maxAttempts) {
        return { error: lastError };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }

  return { error: lastError };
}
