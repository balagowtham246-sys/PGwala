import { EdgeFunctionError, invokeEdgeFunction } from '../edge-functions';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const mockedGetSession = supabase.auth.getSession as jest.Mock;
const mockedInvoke = supabase.functions.invoke as jest.Mock;

describe('invokeEdgeFunction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws 401 UNAUTHORIZED EdgeFunctionError when no session token exists', async () => {
    mockedGetSession.mockResolvedValue({ data: { session: null } });

    await expect(invokeEdgeFunction('create-resident', { full_name: 'Test' })).rejects.toMatchObject({
      name: 'EdgeFunctionError',
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('forwards bearer token and returns data on success', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-123' } },
    });
    mockedInvoke.mockResolvedValue({
      data: { success: true, resident_id: 'res-1' },
      error: null,
      response: undefined,
    });

    const result = await invokeEdgeFunction<{ success: boolean; resident_id: string }>(
      'create-resident',
      { full_name: 'Asha' }
    );

    expect(mockedInvoke).toHaveBeenCalledWith('create-resident', {
      headers: { Authorization: 'Bearer jwt-123' },
      body: { full_name: 'Asha' },
    });
    expect(result).toEqual({ success: true, resident_id: 'res-1' });
  });

  it('throws descriptive NOT_FOUND error when function returns HTTP 404', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-123' } },
    });
    mockedInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code' },
      response: {
        status: 404,
        json: async () => ({ error: 'Not found', code: 'NOT_FOUND' }),
      },
    });

    await expect(invokeEdgeFunction('missing-fn', {})).rejects.toThrow(
      'Backend function "missing-fn" is not deployed yet.'
    );
  });

  it('surfaces server JSON error and code for non-2xx responses', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-123' } },
    });
    mockedInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code' },
      response: {
        status: 409,
        json: async () => ({ error: 'Duplicate email', code: 'CONFLICT' }),
      },
    });

    await expect(invokeEdgeFunction('create-resident', {})).rejects.toMatchObject({
      message: 'Duplicate email',
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('throws EdgeFunctionError when data.success is false', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-123' } },
    });
    mockedInvoke.mockResolvedValue({
      data: { success: false, error: 'Validation failed', code: 'BAD_INPUT' },
      error: null,
      response: undefined,
    });

    await expect(invokeEdgeFunction('manage-warden', {})).rejects.toBeInstanceOf(EdgeFunctionError);
    await expect(invokeEdgeFunction('manage-warden', {})).rejects.toMatchObject({
      message: 'Validation failed',
      code: 'BAD_INPUT',
    });
  });
});

