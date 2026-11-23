# SENTINEL

AIOps observability and automated incident management platform simulating Dynatrace topology monitoring integrated with BMC Helix ITSM workflows.

**Live Demo:** https://apm.iqbalfa.my.id/

## Core Capabilities

- **Interactive Service Dependency Graph:** Directed topology built with React Flow (`@xyflow/react`) mapping `Web App -> API Gateway -> Auth Service -> Payment Service -> PostgreSQL` with live edge latency and throughput metrics.
- **Fault Injection and Cascading Failure Engine:** Node-level incident simulation (`CPU Spike`, `Latency Surge`, `Deadlock`) propagating upstream impact in real time across node statuses and synchronized telemetry charts.
- **Automated Dynatrace-to-BMC Incident Bridge:** Automatic P1 ticket generation (`INC-2026-XXXX`) with initial Root Cause Analysis, live 15-minute SLA countdown timer, status transitions (`OPEN -> INVESTIGATING -> RESOLVED`), webhook JSON payload inspection, and Supabase persistence.
- **120-Second Time-Travel Replay and Log Stream:** Structured live log console correlated via `trace_id` paired with a 120-second ring-buffer scrubber to replay system degradation second by second.

## Tech Stack

- **Framework:** Next.js (App Router), TypeScript, Tailwind CSS
- **Visualization & Motion:** React Flow (`@xyflow/react`), Framer Motion, Custom SVG Telemetry Charts
- **State & Testing:** Zustand, Vitest
- **Backend & Hosting:** Supabase (PostgreSQL), Vercel

## Local Development

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/iqbal-alpha/apm.git
cd apm
npm install
```

2. Configure environment variables by copying `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Populate `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. If omitted, the application runs in local cache mode via `localStorage`.

3. Start the development server:

```bash
npm run dev
```

## Verification

```bash
npm run lint
npx vitest run
npm run build
```

## License

MIT
