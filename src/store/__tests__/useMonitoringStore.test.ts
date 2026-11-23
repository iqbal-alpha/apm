import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectActiveSnapshot, useMonitoringStore } from '@/store/useMonitoringStore';

function installBrowserMocks(fetchImpl: typeof fetch) {
  const storageMap = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storageMap.set(key, val);
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    get length() {
      return storageMap.size;
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  };

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: mockStorage },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchImpl,
    configurable: true,
    writable: true,
  });
}

describe('useMonitoringStore chaos, replay, and Supabase fallback integration', () => {
  beforeEach(() => {
    useMonitoringStore.setState({
      activeFaults: {},
      ticketCreatedForFaultAt: null,
      replayOffsetSeconds: 0,
      selectedNodeId: null,
      highlightedTraceId: null,
      syncMode: 'LOCAL_CACHE',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up global window mock
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('falls back gracefully to LOCAL_CACHE when Supabase API fails or times out', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    installBrowserMocks(failingFetch);

    useMonitoringStore.getState().hydrateClient();
    await new Promise((r) => setTimeout(r, 25));

    const state = useMonitoringStore.getState();
    expect(state.syncMode).toBe('LOCAL_CACHE');
    expect(state.incidents.length).toBeGreaterThanOrEqual(3);
  });

  it('syncs with Supabase API when /api/incidents responds with SUPABASE_SYNCED', async () => {
    const mockDbTicket = {
      id: '11111111-1111-1111-1111-111111111111',
      ticketNumber: 'INC-2026-0895',
      problemId: 'P-261146',
      sourceSystem: 'Dynatrace Davis AI',
      targetItsm: 'BMC Helix ITSM',
      severity: 'P1',
      status: 'RESOLVED',
      scenarioId: 'SCEN-DB-CPU',
      rootNodeId: 'postgres-db',
      affectedServices: ['postgres-db', 'payment-service'],
      title: 'Cloud DB Synced Ticket',
      rootCauseSummary: 'Synced from Supabase',
      webhookPayload: {},
      slaTargetSeconds: 900,
      slaBreached: false,
      triggeredAt: 1_795_360_000_000,
      acknowledgedAt: null,
      resolvedAt: 1_795_360_068_000,
      mttrSeconds: 68,
      activityLogs: [],
    };

    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true, mode: 'SUPABASE_SYNCED', tickets: [mockDbTicket] }),
    } as Response);
    installBrowserMocks(okFetch);

    useMonitoringStore.getState().hydrateClient();
    await new Promise((r) => setTimeout(r, 25));

    const state = useMonitoringStore.getState();
    expect(state.syncMode).toBe('SUPABASE_SYNCED');
    expect(state.incidents[0].ticketNumber).toBe('INC-2026-0895');
    expect(state.ticketSeq).toBe(896);
  });

  it('executes full chaos -> P1 ticket creation -> work note -> mitigation lifecycle cleanly in Local Cache mode', () => {
    const baseTime = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const offlineFetch = vi.fn().mockRejectedValue(new Error('Offline'));
    installBrowserMocks(offlineFetch);

    const store = useMonitoringStore.getState();
    const initialCount = store.incidents.length;

    // 1. Trigger Chaos Drill (SCEN-DB-CPU)
    store.triggerChaosScenario('SCEN-DB-CPU');
    expect(useMonitoringStore.getState().currentMetrics['postgres-db'].status).toBe('CRITICAL');

    // 2. Advance clock +1.2s -> tick auto-creates BMC P1 ticket + sets P1_CREATED pin
    nowSpy.mockReturnValue(baseTime + 1250);
    useMonitoringStore.getState().tick();

    const afterP1 = useMonitoringStore.getState();
    expect(afterP1.incidents.length).toBe(initialCount + 1);
    const createdTicket = afterP1.incidents[0];
    expect(createdTicket.status).toBe('OPEN');
    expect(createdTicket.rootNodeId).toBe('postgres-db');
    expect(afterP1.clusterHealth).toBeLessThan(90);

    // 3. Add Work Note & transition OPEN -> INVESTIGATING
    afterP1.addIncidentWorkNote(createdTicket.id, 'Investigating pg_stat_activity locks');
    useMonitoringStore.getState().updateIncidentStatus(createdTicket.id, 'INVESTIGATING');
    const afterAck = useMonitoringStore.getState().incidents[0];
    expect(afterAck.status).toBe('INVESTIGATING');
    expect(afterAck.activityLogs.some((l) => l.message.includes('pg_stat_activity'))).toBe(true);

    // 4. Execute Auto-Mitigation -> clears faults, resolves P1 ticket with MTTR
    nowSpy.mockReturnValue(baseTime + 45_000);
    useMonitoringStore.getState().executeAutoMitigation();
    const afterMit = useMonitoringStore.getState();
    expect(Object.keys(afterMit.activeFaults).length).toBe(0);
    expect(afterMit.currentMetrics['postgres-db'].status).toBe('HEALTHY');
    expect(afterMit.incidents[0].status).toBe('RESOLVED');
    expect(afterMit.incidents[0].mttrSeconds).toBeGreaterThanOrEqual(12);
  });

  it('caps historyBuffer at 120s and accurately switches frames in Time-Travel Replay mode', () => {
    const baseTime = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const offlineFetch = vi.fn().mockRejectedValue(new Error('Offline'));
    installBrowserMocks(offlineFetch);

    // Inject fault and advance 130 ticks -> buffer stays capped at 120
    useMonitoringStore.getState().triggerChaosScenario('SCEN-GW-STORM');
    for (let s = 1; s <= 130; s++) {
      nowSpy.mockReturnValue(baseTime + s * 1000);
      if (s === 80) {
        useMonitoringStore.getState().executeAutoMitigation();
      } else {
        useMonitoringStore.getState().tick();
      }
    }

    const liveState = useMonitoringStore.getState();
    expect(liveState.historyBuffer.length).toBe(120);
    expect(liveState.currentMetrics['api-gateway'].status).toBe('HEALTHY');

    // Scrub back -60s into the chaos storm window (tick ~70)
    liveState.setReplayOffset(-60);
    const replayState = useMonitoringStore.getState();
    const replaySnap = selectActiveSnapshot(replayState);
    expect(selectActiveSnapshot(replayState)).toBe(replaySnap);
    expect(replayState.replayOffsetSeconds).toBe(-60);
    expect(replaySnap.nodes['api-gateway'].status).toBe('CRITICAL');

    // Return to LIVE and verify React 19 useSyncExternalStore referential identity
    useMonitoringStore.getState().resumeLive();
    const resumedState = useMonitoringStore.getState();
    const liveSnap = selectActiveSnapshot(resumedState);
    expect(selectActiveSnapshot(resumedState)).toBe(liveSnap);
    expect(resumedState.replayOffsetSeconds).toBe(0);
    expect(liveSnap.nodes['api-gateway'].status).toBe('HEALTHY');
  });
});
