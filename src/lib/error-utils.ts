/**
 * Extracts a human-readable error message from any error value,
 * including Supabase PostgREST error objects, AuthApiErrors, and standard Error instances.
 */
export function extractErrorMessage(err: unknown, defaultMessage = 'An unexpected error occurred.'): string {
  if (!err) return defaultMessage;
  if (typeof err === 'string') return err.trim() || defaultMessage;

  if (err instanceof Error) {
    return err.message?.trim() || defaultMessage;
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;

    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error_description === 'string' && record.error_description.trim()) {
      return record.error_description.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
    if (typeof record.details === 'string' && record.details.trim()) {
      return record.details.trim();
    }

    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') {
        return json;
      }
    } catch {
      // Fall through
    }

    try {
      const str = String(err);
      if (str && str !== '[object Object]') {
        return str;
      }
    } catch {
      // Fall through
    }

    return defaultMessage;
  }

  try {
    const str = String(err);
    if (str && str !== '[object Object]') {
      return str;
    }
  } catch {
    // Fall through
  }

  return defaultMessage;
}
