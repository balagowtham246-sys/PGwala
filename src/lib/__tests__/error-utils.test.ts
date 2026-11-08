import { extractErrorMessage } from '../error-utils';

describe('extractErrorMessage', () => {
  it('handles standard Error instances', () => {
    expect(extractErrorMessage(new Error('Password must be 6 characters'))).toBe('Password must be 6 characters');
  });

  it('handles Supabase PostgREST error objects', () => {
    const postgrestErr = {
      message: 'permission denied for column "updated_at"',
      code: '42501',
      details: null,
      hint: null,
    };
    expect(extractErrorMessage(postgrestErr)).toBe('permission denied for column "updated_at"');
  });

  it('handles Supabase Auth error objects with error_description', () => {
    const authErr = {
      error: 'invalid_grant',
      error_description: 'Invalid login credentials',
    };
    expect(extractErrorMessage(authErr)).toBe('Invalid login credentials');
  });

  it('handles plain string errors', () => {
    expect(extractErrorMessage('Direct error string')).toBe('Direct error string');
  });

  it('handles null and undefined with fallback', () => {
    expect(extractErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    expect(extractErrorMessage(undefined)).toBe('An unexpected error occurred.');
  });

  it('never returns [object Object]', () => {
    const weirdObj = Object.create(null);
    expect(extractErrorMessage(weirdObj)).toBe('An unexpected error occurred.');
  });
});

