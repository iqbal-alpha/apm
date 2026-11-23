'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, FileText, Network, Terminal, Zap } from 'lucide-react';
import { BmcIncidentPanel } from '@/components/incident/BmcIncidentPanel';
import { TopCommandBar } from '@/components/layout/TopCommandBar';
import { TimeTravelLogDock } from '@/components/logs/TimeTravelLogDock';
import { MobileNodeBottomSheet } from '@/components/mobile/MobileNodeBottomSheet';
import { TelemetryChartsPanel } from '@/components/telemetry/TelemetryChartsPanel';
import { ServiceTopologyGraph } from '@/components/topology/ServiceTopologyGraph';
import { ActionButton } from '@/components/ui/ActionButton';
import { useMonitoringStore } from '@/store/useMonitoringStore';
import type { ServiceNodeId } from '@/types/monitoring';

type MobileTab = 'topology' | 'incidents' | 'logs';

export default function SentinelCommandCenterPage() {
  const hydrateClient = useMonitoringStore((s) => s.hydrateClient);
  const tick = useMonitoringStore((s) => s.tick);
  const activeFaults = useMonitoringStore((s) => s.activeFaults);
  const activeScenario = useMonitoringStore((s) => s.activeScenario);
  const incidents = useMonitoringStore((s) => s.incidents);
  const triggerChaosScenario = useMonitoringStore((s) => s.triggerChaosScenario);
  const executeAutoMitigation = useMonitoringStore((s) => s.executeAutoMitigation);

  const [mobileTab, setMobileTab] = useState<MobileTab>('topology');
  const [sheetNodeId, setSheetNodeId] = useState<ServiceNodeId | null>(null);

  useEffect(() => {
    hydrateClient();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    }, 1000);

    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [hydrateClient, tick]);

  const hasFault = Object.keys(activeFaults).length > 0;
  const openTicketsCount = incidents.filter((t) => t.status !== 'RESOLVED').length;

  return (
    <div className="flex min-h-[100dvh] xl:h-[100dvh] xl:overflow-hidden flex-col bg-[var(--bg-ground)]">
      {/* Top Command Bar (56px Desktop / 52px Mobile) */}
      <TopCommandBar />

      {/* ==================================================================== */}
      {/* DESKTOP COMMAND CENTER (>= 1280px, 1px Hairline Split matching Figma) */}
      {/* ==================================================================== */}
      <div className="hidden xl:flex flex-1 min-h-0 flex-col">
        {/* Main Split: Left React Flow DAG + Right 400px Telemetry/BMC Drawer */}
        <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_400px] gap-px bg-[var(--border-subtle)]">
          <div className="min-w-0 min-h-0 bg-[var(--bg-ground)]">
            <ServiceTopologyGraph isMobile={false} />
          </div>

          <aside className="flex min-h-0 flex-col bg-[var(--bg-surface)]">
            <TelemetryChartsPanel />
            <BmcIncidentPanel />
          </aside>
        </div>

        {/* Bottom Time-Travel Replay & Log Stream Dock (218px) */}
        <div className="h-[218px] shrink-0">
          <TimeTravelLogDock />
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TABLET SPLIT VIEW (768px - 1279px)                                   */}
      {/* ==================================================================== */}
      <div className="hidden md:flex xl:hidden flex-1 flex-col gap-px bg-[var(--border-subtle)]">
        <div className="h-[400px] w-full bg-[var(--bg-ground)]">
          <ServiceTopologyGraph isMobile={false} />
        </div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_360px] gap-px bg-[var(--border-subtle)]">
          <div className="flex flex-col gap-px bg-[var(--border-subtle)]">
            <TelemetryChartsPanel />
            <div className="min-h-[280px] flex-1 bg-[var(--bg-surface)]">
              <TimeTravelLogDock />
            </div>
          </div>
          <div className="bg-[var(--bg-surface)]">
            <BmcIncidentPanel />
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MOBILE PRO 3-TAB SRE EXPERIENCE (< 768px)                            */}
      {/* ==================================================================== */}
      <div className="flex md:hidden flex-1 min-h-0 flex-col">
        <main className="flex-1 min-h-0 overflow-y-auto">
          {mobileTab === 'topology' && (
            <div className="h-[580px] w-full">
              <ServiceTopologyGraph
                isMobile
                onMobileNodeTap={(nodeId) => setSheetNodeId(nodeId)}
              />
            </div>
          )}

          {mobileTab === 'incidents' && (
            <div className="min-h-full bg-[var(--bg-surface)]">
              <BmcIncidentPanel />
            </div>
          )}

          {mobileTab === 'logs' && (
            <div className="flex min-h-full flex-col bg-[var(--bg-surface)]">
              <TelemetryChartsPanel />
              <TimeTravelLogDock />
            </div>
          )}
        </main>

        {/* Sticky Dual Chaos CTA Bar (48px touch targets) */}
        <div className="grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <ActionButton
            variant="simulate"
            size="touch"
            fullWidth
            onClick={() => triggerChaosScenario(activeScenario)}
          >
            <Zap className="h-4 w-4 text-[var(--warn-bright)]" />
            <span>Simulate Spike</span>
          </ActionButton>

          <ActionButton
            variant={hasFault ? 'mitigate' : 'ghost'}
            size="touch"
            fullWidth
            disabled={!hasFault}
            onClick={executeAutoMitigation}
          >
            <Check className="h-4 w-4" />
            <span>Mitigate P1</span>
          </ActionButton>
        </div>

        {/* 3-Tab Bottom Navigation + Safe-Area Spacing */}
        <nav
          aria-label="Mobile SRE Navigation"
          className="grid grid-cols-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 pt-1.5 pb-[max(12px,env(safe-area-inset-bottom))]"
        >
          {(
            [
              { id: 'topology', label: 'Topology', icon: Network },
              {
                id: 'incidents',
                label: openTicketsCount > 0 ? `BMC Tickets (${openTicketsCount})` : 'BMC Tickets',
                icon: FileText,
              },
              { id: 'logs', label: 'Logs & Replay', icon: Terminal },
            ] as Array<{
              id: MobileTab;
              label: string;
              icon: React.ComponentType<{ className?: string }>;
            }>
          ).map((tab) => {
            const Icon = tab.icon;
            const active = mobileTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMobileTab(tab.id)}
                className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-semibold transition-colors ${
                  active ? 'text-[var(--telemetry-bright)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{tab.label}</span>
                {active && (
                  <motion.span
                    layoutId="mobile-tab-indicator"
                    className="mt-0.5 h-[2px] w-10 rounded-full bg-[var(--telemetry-bright)]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Slide-Up Node Telemetry Bottom Sheet */}
        <MobileNodeBottomSheet
          nodeId={sheetNodeId}
          onClose={() => setSheetNodeId(null)}
        />
      </div>
    </div>
  );
}
