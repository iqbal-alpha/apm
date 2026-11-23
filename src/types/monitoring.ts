export type ServiceNodeId =
  | 'web-app'
  | 'api-gateway'
  | 'auth-service'
  | 'payment-service'
  | 'postgres-db';

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export type ChaosScenarioId =
  | 'SCEN-DB-CPU'
  | 'SCEN-PAY-SPIKE'
  | 'SCEN-AUTH-LEAK'
  | 'SCEN-GW-STORM';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export type TicketStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';

export type IncidentActionType =
  | 'AUTO_CREATED'
  | 'CASCADE_DETECTED'
  | 'STATUS_CHANGE'
  | 'WORK_NOTE'
  | 'AUTO_MITIGATED'
  | 'SLA_BREACH';

export interface ServiceMetrics {
  cpu: number;
  latencyP95: number;
  errorRate: number;
  rps: number;
  status: HealthStatus;
  faultSeverity: number;
}

export interface ServiceNodeConfig {
  id: ServiceNodeId;
  name: string;
  host: string;
  region: string;
  tier: string;
  baseCpu: number;
  baseLatencyMs: number;
  baseErrorRate: number;
  baseRps: number;
  cpuSigma: number;
  latencySigma: number;
  errorSigma: number;
  propagationMultiplier: number;
  desktopPos: { x: number; y: number };
  mobilePos: { x: number; y: number };
}

export interface ServiceNodeRuntime extends ServiceNodeConfig, ServiceMetrics {
  isRootCause: boolean;
  cascadedFrom: ServiceNodeId | null;
}

export interface EdgeConfig {
  id: string;
  source: ServiceNodeId;
  target: ServiceNodeId;
  weight: number;
  baseLatencyMs: number;
  baseRps: number;
}

export interface EdgeTelemetry extends EdgeConfig {
  latencyMs: number;
  rps: number;
  errorRate: number;
  status: HealthStatus;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  level: LogLevel;
  serviceId: ServiceNodeId;
  serviceName: string;
  traceId: string;
  message: string;
}

export interface TelemetrySnapshot {
  timestamp: number;
  offsetSeconds: number;
  clusterHealth: number;
  nodes: Record<ServiceNodeId, ServiceMetrics>;
  edges: EdgeTelemetry[];
  eventPin?: 'ANOMALY_START' | 'P1_CREATED' | 'MITIGATED';
}

export interface IncidentActivityLog {
  id: string;
  ticketId: string;
  actor: string;
  actionType: IncidentActionType;
  fromStatus?: TicketStatus | null;
  toStatus?: TicketStatus | null;
  message: string;
  createdAt: string;
}

export interface IncidentTicket {
  id: string;
  ticketNumber: string;
  problemId: string;
  sourceSystem: string;
  targetItsm: string;
  severity: 'P1' | 'P2' | 'P3';
  status: TicketStatus;
  scenarioId: ChaosScenarioId | 'MANUAL_SPIKE';
  rootNodeId: ServiceNodeId;
  affectedServices: ServiceNodeId[];
  title: string;
  rootCauseSummary: string;
  webhookPayload: Record<string, unknown>;
  slaTargetSeconds: number;
  slaBreached: boolean;
  triggeredAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  mttrSeconds: number | null;
  activityLogs: IncidentActivityLog[];
}

export interface ActiveFault {
  nodeId: ServiceNodeId;
  scenarioId: ChaosScenarioId | 'MANUAL_SPIKE';
  severity: number;
  injectedAt: number;
}

export interface ChaosScenarioMeta {
  id: ChaosScenarioId;
  label: string;
  shortLabel: string;
  rootNodeId: ServiceNodeId;
  title: string;
  dominoSummary: string;
  rcaSummary: string;
  remediationAction: string;
}
