import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ground: 'var(--bg-ground)',
        surface: 'var(--bg-surface)',
        raised: 'var(--bg-raised)',
        floating: 'var(--bg-floating)',
        border: {
          subtle: 'var(--border-subtle)',
          default: 'var(--border-default)',
          focus: 'var(--border-focus)',
        },
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        healthy: {
          DEFAULT: 'var(--healthy)',
          bright: 'var(--healthy-bright)',
          tint: 'var(--healthy-tint)',
        },
        telemetry: {
          DEFAULT: 'var(--telemetry)',
          bright: 'var(--telemetry-bright)',
          tint: 'var(--telemetry-tint)',
        },
        warn: {
          DEFAULT: 'var(--warn)',
          bright: 'var(--warn-bright)',
          tint: 'var(--warn-tint)',
        },
        critical: {
          DEFAULT: 'var(--critical)',
          bright: 'var(--critical-bright)',
          tint: 'var(--critical-tint)',
        },
        itsm: {
          DEFAULT: 'var(--itsm)',
          bright: 'var(--itsm-bright)',
          tint: 'var(--itsm-tint)',
        },
      },
      fontFamily: {
        sans: ['var(--font-instrument-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-spline-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        panel: 'var(--radius-panel)',
        node: 'var(--radius-node)',
        control: 'var(--radius-control)',
        pill: 'var(--radius-pill)',
      },
    },
  },
  plugins: [],
};

export default config;
