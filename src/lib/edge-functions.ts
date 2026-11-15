import { supabase } from '@/lib/supabase';

export class EdgeFunctionError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Invoke a Supabase Edge Function with the current session JWT and surface the
 * server-provided error message (functions return { success:false, error, code }).
 */
export async function invokeEdgeFunction<T = Record<string, any>>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new EdgeFunctionError('Your session has expired. Please sign in again.', 401, 'UNAUTHORIZED');
  }

  const { data, error, response } = await supabase.functions.invoke(name, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body,
  });

  if (error) {
    const res = response ?? ((error as any)?.context as Response | undefined);
    const status: number | undefined = res?.status;
    let message = '';
    let code: string | undefined;
    try {
      const payload = res && typeof res.json === 'function' ? await res.json() : null;
      const serverMsg = payload?.error ?? payload?.message ?? payload?.msg;
      if (serverMsg) message = String(serverMsg);
      if (payload?.code) code = String(payload.code);
    } catch {
      // Response body was not JSON or already consumed
    }

    if (status === 404 || code === 'NOT_FOUND') {
      throw new EdgeFunctionError(
        `Backend function "${name}" is not deployed yet. Deploy it with: supabase functions deploy ${name}`,
        404,
        'NOT_FOUND'
      );
    }

    if (!message) {
      message =
        error.message && error.message !== 'Edge Function returned a non-2xx status code'
          ? error.message
          : status
          ? `Request failed (HTTP ${status}). Please try again.`
          : 'Network error. Please check your connection and try again.';
    }
    throw new EdgeFunctionError(message, status, code);
  }

  if (data && (data as any).success === false) {
    throw new EdgeFunctionError(String((data as any).error ?? 'Request failed.'), undefined, (data as any).code);
  }
  return data as T;
}
