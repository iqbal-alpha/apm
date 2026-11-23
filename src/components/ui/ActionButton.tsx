'use client';

import React from 'react';

export type ActionButtonVariant = 'simulate' | 'mitigate' | 'primary' | 'ghost';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionButtonVariant;
  size?: 'sm' | 'md' | 'touch';
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  simulate:
    'bg-[var(--bg-raised)] border-[var(--border-focus)] text-[var(--text-primary)] hover:border-[var(--warn)] hover:bg-[var(--warn-tint)] hover:text-[var(--warn-bright)]',
  mitigate:
    'bg-[var(--healthy-tint)] border-[var(--healthy)] text-[var(--healthy-bright)] hover:bg-[rgba(16,185,129,0.22)]',
  primary:
    'bg-[var(--telemetry-tint)] border-[var(--telemetry)] text-[var(--telemetry-bright)] hover:bg-[rgba(14,165,233,0.22)]',
  ghost:
    'bg-transparent border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-focus)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]',
};

const SIZE_CLASSES: Record<NonNullable<ActionButtonProps['size']>, string> = {
  sm: 'h-[30px] px-2.5 text-[11px]',
  md: 'h-[34px] px-3 py-[9px] text-[12px]',
  touch: 'min-h-[48px] px-4 text-[13px]',
};

export function ActionButton({
  variant = 'ghost',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  type = 'button',
  ...props
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border font-sans font-semibold tracking-[0.01em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-ground)] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
