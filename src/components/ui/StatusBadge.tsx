'use client';

import React from 'react';
import type { HealthStatus } from '@/types/monitoring';

export type BadgeTone = HealthStatus | 'TELEMETRY' | 'ITSM';

interface StatusBadgeProps {
  tone: BadgeTone;
  label: string;
  pulse?: boolean;
  className?: string;
}

const TONE_STYLES: Record<BadgeTone, { container: string; dot: string }> = {
  HEALTHY: {
    container: 'bg-[var(--healthy-tint)] border-[var(--healthy)] text-[var(--healthy-bright)]',
    dot: 'bg-[var(--healthy-bright)]',
  },
  DEGRADED: {
    container: 'bg-[var(--warn-tint)] border-[var(--warn)] text-[var(--warn-bright)]',
    dot: 'bg-[var(--warn-bright)]',
  },
  CRITICAL: {
    container: 'bg-[var(--critical-tint)] border-[var(--critical)] text-[var(--critical-bright)]',
    dot: 'bg-[var(--critical-bright)]',
  },
  TELEMETRY: {
    container: 'bg-[var(--telemetry-tint)] border-[var(--telemetry)] text-[var(--telemetry-bright)]',
    dot: 'bg-[var(--telemetry-bright)]',
  },
  ITSM: {
    container: 'bg-[var(--itsm-tint)] border-[var(--itsm)] text-[var(--itsm-bright)]',
    dot: 'bg-[var(--itsm-bright)]',
  },
};

export function StatusBadge({ tone, label, pulse = false, className = '' }: StatusBadgeProps) {
  const styles = TONE_STYLES[tone];

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 py-0.5 font-mono text-[11px] font-medium leading-[1.2] tracking-[0.02em] whitespace-nowrap ${styles.container} ${className}`}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${styles.dot}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      </span>
      <span>{label}</span>
    </span>
  );
}
