'use client';

import React, { useId, useMemo } from 'react';
import { Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { LogStreamRow } from '@/components/logs/LogStreamRow';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SERVICE_CONFIGS, useMonitoringStore } from '@/store/useMonitoringStore';

export function TimeTravelLogDock() {
  const historyBuffer = useMonitoringStore((s) => s.historyBuffer);
  const replayOffsetSeconds = useMonitoringStore((s) => s.replayOffsetSeconds);
  const setReplayOffset = useMonitoringStore((s) => s.setReplayOffset);
  const resumeLive = useMonitoringStore((s) => s.resumeLive);
  const logs = useMonitoringStore((s) => s.logs);
  const isLogPaused = useMonitoringStore((s) => s.isLogPaused);
  const toggleLogPause = useMonitoringStore((s) => s.toggleLogPause);
  const clearLogs = useMonitoringStore((s) => s.clearLogs);
  const logLevelFilter = useMonitoringStore((s) => s.logLevelFilter);
  const setLogLevelFilter = useMonitoringStore((s) => s.setLogLevelFilter);
  const selectedNodeId = useMonitoringStore((s) => s.selectedNodeId);
  const selectNode = useMonitoringStore((s) => s.selectNode);
  const highlightedTraceId = useMonitoringStore((s) => s.highlightedTraceId);
  const highlightTrace = useMonitoringStore((s) => s.highlightTrace);

  const scrubberId = useId();
  const isReplaying = replayOffsetSeconds < 0;
  const maxPast = Math.max(1, historyBuffer.length - 1);

  const currentSnap = useMemo(() => {
    if (historyBuffer.length === 0) return null;
    const idx = Math.max(
      0,
      Math.min(historyBuffer.length - 1, historyBuffer.length - 1 + replayOffsetSeconds)
    );
    return historyBuffer[idx];
  }, [historyBuffer, replayOffsetSeconds]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (selectedNodeId && entry.serviceId !== selectedNodeId) return false;
      if (logLevelFilter === 'WARN+' && entry.level === 'INFO') return false;
      if (
        logLevelFilter === 'ERROR/FATAL' &&
        entry.level !== 'ERROR' &&
        entry.level !== 'FATAL'
      ) {
        return false;
      }
      if (isReplaying && currentSnap && entry.timestampMs > currentSnap.timestamp) {
        return false;
      }
      return true;
    });
  }, [logs, selectedNodeId, logLevelFilter, isReplaying, currentSnap]);

  // Extract event pins across the ring buffer
  const eventPins = useMemo(() => {
    if (historyBuffer.length <= 1) return [];
    const total = historyBuffer.length - 1;
    return historyBuffer
      .map((snap, i) => {
        if (!snap.eventPin) return null;
        return {
          pct: (i / total) * 100,
          pin: snap.eventPin,
          offset: snap.offsetSeconds,
        };
      })
      .filter(Boolean) as Array<{
      pct: number;
      pin: 'ANOMALY_START' | 'P1_CREATED' | 'MITIGATED';
      offset: number;
    }>;
  }, [historyBuffer]);

  const activeTimeText = currentSnap
    ? new Date(currentSnap.timestamp).toISOString().slice(11, 23) + 'Z'
    : 'LIVE';

  return (
    <section
      aria-label="120s Time-Travel Replay & Live Log Stream"
      className={`flex h-full min-h-[260px] md:min-h-0 flex-col gap-1.5 bg-[var(--bg-surface)] px-3 md:px-4 py-2 transition-colors duration-200 ${
        isReplaying
          ? 'border-2 border-[var(--warn)]'
          : 'border-t border-[var(--border-subtle)]'
      }`}
    >
      {/* Top Toolbar: Replay Indicator + Filter Chips */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isReplaying ? (
            <StatusBadge tone="DEGRADED" label={`⏸ TIME-TRAVEL REPLAY · ${replayOffsetSeconds}s`} />
          ) : (
            <StatusBadge tone="TELEMETRY" pulse label="● LIVE STREAM" />
          )}
          <span className="truncate font-sans text-[13px] font-semibold text-[var(--text-primary)]">
            120s Time-Travel Replay Scrubber
          </span>
          <span className="hidden sm:inline tabular-nums-strict text-[11px] text-[var(--text-muted)]">
            {isReplaying ? `${replayOffsetSeconds}s` : 'T-0s'} · {activeTimeText}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'WARN+', 'ERROR/FATAL'] as const).map((lvl) => {
            const active = logLevelFilter === lvl;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => setLogLevelFilter(lvl)}
                className={`h-[26px] rounded-[var(--radius-pill)] border px-2 font-mono text-[10.5px] font-medium transition-colors ${
                  active
                    ? lvl === 'ERROR/FATAL'
                      ? 'border-[var(--critical)] bg-[var(--critical-tint)] text-[var(--critical-bright)]'
                      : 'border-[var(--telemetry)] bg-[var(--telemetry-tint)] text-[var(--telemetry-bright)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {lvl}
              </button>
            );
          })}

          {selectedNodeId && (
            <button
              type="button"
              onClick={() => selectNode(null)}
              className="h-[26px] rounded-[var(--radius-pill)] border border-[var(--warn)] bg-[var(--warn-tint)] px-2 font-mono text-[10.5px] text-[var(--warn-bright)]"
            >
              svc={SERVICE_CONFIGS[selectedNodeId].host.split('.')[0]} ×
            </button>
          )}

          {highlightedTraceId && (
            <button
              type="button"
              onClick={() => highlightTrace(null)}
              className="h-[26px] rounded-[var(--radius-pill)] border border-[var(--telemetry)] bg-[var(--telemetry-tint)] px-2 font-mono text-[10.5px] text-[var(--telemetry-bright)]"
            >
              trace={highlightedTraceId} ×
            </button>
          )}

          {isReplaying && (
            <ActionButton variant="primary" size="sm" onClick={resumeLive} className="!h-[26px]">
              <RotateCcw className="h-3 w-3" />
              <span>Resume Live</span>
            </ActionButton>
          )}

          <button
            type="button"
            onClick={toggleLogPause}
            aria-label={isLogPaused ? 'Resume live log stream' : 'Pause live log stream'}
            className="inline-flex h-[26px] items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 font-mono text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {isLogPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            <span className="hidden sm:inline">{isLogPaused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            onClick={clearLogs}
            aria-label="Clear log console"
            className="inline-flex h-[26px] items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 font-mono text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 120-Second Timeline Track with Event Pins */}
      <div
        className={`relative flex flex-col gap-1 rounded-[var(--radius-control)] border bg-[var(--bg-ground)] px-3 py-1.5 ${
          isReplaying ? 'border-[var(--warn)]' : 'border-[var(--border-subtle)]'
        }`}
      >
        <div className="flex items-center justify-between font-mono text-[10px]">
          <span className="text-[var(--text-muted)]">-{maxPast}s</span>
          <span className={isReplaying ? 'text-[var(--warn-bright)] font-semibold' : 'text-[var(--text-muted)]'}>
            {isReplaying ? `REPLAY FRAME ${replayOffsetSeconds}s` : '120s Ring Buffer'}
          </span>
          <span className={isReplaying ? 'text-[var(--text-muted)]' : 'text-[var(--telemetry-bright)]'}>
            0s LIVE
          </span>
        </div>

        <div className="relative flex h-5 items-center">
          {/* Anomaly & Recovery Event Pins */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1">
            {eventPins.map((ep, idx) => (
              <span
                key={`${ep.pin}-${idx}`}
                style={{ left: `${ep.pct}%` }}
                className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  ep.pin === 'P1_CREATED'
                    ? 'bg-[var(--itsm-bright)]'
                    : ep.pin === 'ANOMALY_START'
                    ? 'bg-[var(--critical-bright)]'
                    : 'bg-[var(--healthy-bright)]'
                }`}
              />
            ))}
          </div>

          <input
            id={scrubberId}
            name="replayOffset"
            type="range"
            aria-label="Time-travel replay scrubber slider"
            min={-maxPast}
            max={0}
            step={1}
            value={Math.max(-maxPast, replayOffsetSeconds)}
            onChange={(e) => setReplayOffset(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-[var(--telemetry-bright)]"
          />
        </div>
      </div>

      {/* Scrollable Log Terminal Container */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-ground)]">
        {filteredLogs.length === 0 ? (
          <div className="flex h-full min-h-[72px] items-center justify-center font-mono text-[11.5px] text-[var(--text-muted)]">
            No log lines match active filters.
          </div>
        ) : (
          filteredLogs.map((log) => (
            <LogStreamRow
              key={log.id}
              log={log}
              isHighlighted={highlightedTraceId === log.traceId}
              onSelectTrace={highlightTrace}
            />
          ))
        )}
      </div>
    </section>
  );
}
