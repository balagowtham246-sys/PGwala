import { supabase } from '@/lib/supabase';
import { resetPerfMonitor } from '@/lib/perf-monitor';
import {
  fetchWashingMachineStatus,
  formatCountdown,
  isWashingMachineConflictError,
  releaseWashingMachineUnit,
  requestWashingMachineAccess,
  startWashingMachineUnit,
} from '../washing-machine.service';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

const mockedRpc = supabase.rpc as jest.Mock;

describe('washing-machine.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPerfMonitor();
  });

  it('formats countdown accurately for active and finished cycles', () => {
    const startIso = '2026-11-19T10:00:00.000Z';
    const tenMinsLater = new Date('2026-11-19T10:10:00.000Z').getTime();
    expect(formatCountdown(startIso, tenMinsLater)).toEqual({
      label: '~35m left',
      remainingSeconds: 35 * 60,
    });

    const fiftyMinsLater = new Date('2026-11-19T10:50:00.000Z').getTime();
    expect(formatCountdown(startIso, fiftyMinsLater)).toEqual({
      label: 'Finishing soon',
      remainingSeconds: 0,
    });
  });

  it('fetches multi-unit status and falls back to legacy single-unit RPC when needed', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        machines: [
          {
            id: 'm-1',
            property_id: 'prop-1',
            machine_number: 1,
            machine_name: 'WM 1',
            is_active: true,
            status: 'free',
            current_resident_id: null,
            current_resident_name: null,
            current_resident_room: null,
            started_at: null,
            updated_at: '2026-11-19T10:00:00Z',
          },
        ],
        resident_enabled: true,
        request_status: 'none',
      },
      error: null,
    });

    const multi = await fetchWashingMachineStatus('prop-1', 'student');
    expect(multi.ok).toBe(true);
    if (multi.ok) {
      expect(multi.data.machines).toHaveLength(1);
      expect(multi.data.residentEnabled).toBe(true);
    }

    // Legacy fallback path
    mockedRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'function not found' } })
      .mockResolvedValueOnce({
        data: {
          success: true,
          property_id: 'prop-1',
          status: 'in_use',
          current_resident_id: 'res-1',
          current_resident_name: 'Asha',
          current_resident_room: '101',
          started_at: '2026-11-19T10:00:00Z',
          updated_at: '2026-11-19T10:00:00Z',
        },
        error: null,
      });

    const legacy = await fetchWashingMachineStatus('prop-1', 'owner');
    expect(mockedRpc).toHaveBeenLastCalledWith('get_or_create_wm_status', {
      p_property_id: 'prop-1',
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.data.machines?.[0]?.machine_name).toBe('Washing Machine 1');
    }
  });

  it('handles not_enabled and legacy fallback when starting or releasing a machine', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: { success: false, not_enabled: true, error: 'Opt-in required' },
      error: null,
    });
    const blocked = await startWashingMachineUnit('prop-1', 'm-1');
    expect(blocked).toEqual({
      ok: true,
      data: { status: 'not_enabled', errorMessage: 'Opt-in required' },
    });

    mockedRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'missing unit rpc' } })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const startedLegacy = await startWashingMachineUnit('prop-1', 'm-1');
    expect(startedLegacy).toEqual({
      ok: true,
      data: { status: 'started', usedLegacyFallback: true },
    });

    mockedRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'missing unit release' } })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const releasedLegacy = await releaseWashingMachineUnit('prop-1', 'm-1');
    expect(releasedLegacy).toEqual({
      ok: true,
      data: { usedLegacyFallback: true },
    });
  });

  it('rejects domain errors directly without falling back to legacy RPC', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: false,
        code: 'WM_RESIDENT_ACTIVE_SESSION',
        error: 'You are already using Washing Machine 1. Mark it free before starting another machine.',
      },
      error: null,
    });

    const activeConflict = await startWashingMachineUnit('prop-1', 'm-2');
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(activeConflict.ok).toBe(false);
    if (!activeConflict.ok) {
      expect(activeConflict.error.message).toContain('Washing Machine 1');
    }

    mockedRpc.mockClear();
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: false,
        error: 'You can only release your own washing machine session.',
      },
      error: null,
    });

    const releaseDenied = await releaseWashingMachineUnit('prop-1', 'm-1');
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(releaseDenied.ok).toBe(false);
    if (!releaseDenied.ok) {
      expect(releaseDenied.error.message).toContain('release your own');
    }
  });

  it('normalizes errors for requestWashingMachineAccess', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: { success: false, error: 'Already requested' },
      error: null,
    });
    const res = await requestWashingMachineAccess('prop-1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toBe('Already requested');
    }
  });

  it('coalesces concurrent double-taps on startWashingMachineUnit and tags slot race conflicts', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mockedRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        })
    );

    const p1 = startWashingMachineUnit('prop-1', 'm-1');
    const p2 = startWashingMachineUnit('prop-1', 'm-1');
    resolveRpc({
      data: { success: true, machine_name: 'Washing Machine 1' },
      error: null,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({
      ok: true,
      data: { status: 'started', machineName: 'Washing Machine 1', usedLegacyFallback: false },
    });
    expect(r2).toEqual(r1);

    mockedRpc.mockResolvedValueOnce({
      data: {
        success: false,
        error: 'This washing machine is currently in use.',
      },
      error: null,
    });

    const raceConflict = await startWashingMachineUnit('prop-1', 'm-1');
    expect(raceConflict.ok).toBe(false);
    if (!raceConflict.ok) {
      expect(isWashingMachineConflictError(raceConflict.error)).toBe(true);
      expect(raceConflict.error.code).toBe('WM_CONFLICT');
    }
  });
});
