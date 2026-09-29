export interface RoutingWeights {
  speed: number;
  reliability: number;
  intelligence: number;
}

export interface PromptCompressionConfig {
  mode: "Off" | "Lossless" | "Standard" | "Aggressive";
  repeated_blocks: boolean;
  whitespace_cleanup: boolean;
  json_tables: boolean;
  superseded_file_reads: boolean;
  tool_output_filter: boolean;
  relevance_filter: boolean;
  older_turns: boolean;
  token_ceiling: boolean;
}

export interface ModelEntry {
  id: string;
  name: string;
  ollama_tag?: string;
  role: string;
  task_types: string[];
  state: "loaded" | "idle" | "available" | "unavailable";
  ctx_window?: number;
  intelligence: number;
  reliability: number;
  speed: number;
  resident: boolean;
  vram_usage_mb: number;
}

export interface ModelStats {
  requests: number;
  success_rate: number;
  avg_latency_ms: number;
  task_types: Record<string, number>;
}

export interface ModelStatsResponse {
  models: Record<string, ModelStats>;
}

export interface ModelRegistryResponse {
  models: ModelEntry[];
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  by_model: Record<string, AnalyticsByModelEntry>;
  by_task_type: Record<string, AnalyticsByTaskTypeEntry>;
  time_series: AnalyticsTimeSeriesPoint[];
}

// ── Live routing-scores contract (POST /api/models/routing-scores) ─────────

export interface RoutingScoredModel {
  id: string;
  name: string;
  role: string;
  task_types: string[];
  intelligence: number;
  reliability: number;
  speed: number;
  score: number;
  rank: number;
}

export interface RoutingScoresResponse {
  scores: RoutingScoredModel[];
  weights_used: RoutingWeights;
}

export interface RoutingScoresRequest {
  speed: number;
  reliability: number;
  intelligence: number;
}

// ── Live analytics contract (GET /api/analytics) ───────────────────────────

export interface AnalyticsSummary {
  total_requests: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface AnalyticsByModelEntry {
  requests: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface AnalyticsByTaskTypeEntry {
  requests: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface AnalyticsTimeSeriesPoint {
  hour: string;
  requests: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  by_model: Record<string, AnalyticsByModelEntry>;
  by_task_type: Record<string, AnalyticsByTaskTypeEntry>;
  time_series: AnalyticsTimeSeriesPoint[];
}

export interface TaskStatus {
  task_id: string;
  status: "waiting_approval" | "completed" | "failed" | "running";
  state?: Record<string, any>;
  is_paused?: boolean;
  next_node?: string[];
}

export interface AuditEntry {
  timestamp: string;
  task_id: string;
  step_type: string;
  model_used: string;
  duration_ms: number;
  input_summary: string;
  output_summary: string;
  status: string;
  user: string;
}

export interface AuditVerifyResult {
  valid: boolean;
  entries_checked: number;
  first_invalid_seq: number | null;
  chain_start_seq: number | null;
  legacy_unhashed_entries: number;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  detail: string;
  decision?: "approved" | "rejected";
  reason?: string;
}
