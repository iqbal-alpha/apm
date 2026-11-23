'use client';

import React from 'react';
import type { LogEntry, LogLevel } from '@/types/monitoring';

interface LogStreamRowProps {
  log: LogEntry;
  isHighlighted: boolean;
  onSelectTrace: (traceId: string) => void;
}

const LEVEL_STYLES: Record<
  LogLevel,
  { accent: string; badgeBg: string; badgeText: string; msgText: string }
> = {
  INFO: {
    accent: 'bg-[var(--telemetry)]',
    badgeBg: 'bg-[var(--telemetry-tint)] border-[var(--telemetry)]',
    badgeText: 'text-[var(--telemetry-bright)]',
    msgText: 'text-[var(--text-secondary)]',
  },
  WARN: {
    accent: 'bg-[var(--warn)]',
    badgeBg: 'bg-[var(--warn-tint)] border-[var(--warn)]',
    badgeText: 'text-[var(--warn-bright)]',
    msgText: 'text-[var(--warn-bright)]',
  },
  ERROR: {
    accent: 'bg-[var(--critical)]',
    badgeBg: 'bg-[var(--critical-tint)] border-[var(--critical)]',
    badgeText: 'text-[var(--critical-bright)]',
    msgText: 'text-[var(--text-primary)]',
  },
  FATAL: {
    accent: 'bg-[var(--critical-bright)]',
    badgeBg: 'bg-[var(--critical-tint)] border-[var(--critical)]',
    badgeText: 'text-[var(--critical-bright)]',
    msgText: 'text-[var(--critical-bright)]',
  },
};

export function LogStreamRow({ log, isHighlighted, onSelectTrace }: LogStreamRowProps) {
  const styles = LEVEL_STYLES[log.level];

  return (
    <button
      type="button"
      onClick={() => onSelectTrace(log.traceId)}
      title="Click to highlight correlated trace path on dependency graph"
      className={`group relative flex w-full items-center gap-2.5 border-b border-[var(--border-subtle)] px-2.5 py-1.5 md:h-[28px] md:py-0 text-left font-mono text-[11.5px] transition-colors hover:bg-[var(--bg-raised)] ${
        isHighlighted ? 'bg-[var(--telemetry-tint)]' : 'bg-transparent'
      } ${log.level === 'FATAL' || log.level === 'ERROR' ? 'log-arrival-flash' : ''}`}
    >
      {/* Left 3px Severity Bar */}
      <span className={`absolute inset-y-0 left-0 w-[3px] ${styles.accent}`} />

      <span className="tabular-nums-strict shrink-0 text-[11px] text-[var(--text-muted)] pl-1">
        {log.timestamp}
      </span>

      <span
        className={`inline-flex w-[46px] shrink-0 items-center justify-center rounded-[var(--radius-pill)] border py-[1px] text-[10px] font-semibold ${styles.badgeBg} ${styles.badgeText}`}
      >
        {log.level}
      </span>

      <span className="hidden sm:inline-block w-[112px] shrink-0 truncate text-[11px] text-[var(--telemetry-bright)]">
        {log.serviceName}
      </span>

      <span className="hidden md:inline-block w-[82px] shrink-0 truncate text-[11px] text-[var(--text-muted)]">
        {log.traceId}
      </span>

      <span className={`min-w-0 flex-1 truncate text-[11.5px] ${styles.msgText}`}>
        {log.message}
      </span>
    </button>
  );
}
