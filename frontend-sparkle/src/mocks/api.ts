/**
 * Client-side mock API layer for LEX Sparkle.
 *
 * This module provides a transparent drop-in replacement for the real backend.
 * It is used when `VITE_USE_MOCK_API=true` in the environment.
 *
 * When enabled, all endpoints return realistic static data so the UI can be
 * built and reviewed without a running backend. Switch to the real API by
 * setting `VITE_USE_MOCK_API=false` (or omitting the flag).
 */
import type {
  RoutingWeights,
  ModelEntry,
  ModelStats,
  AuditEntry,
  AuditVerifyResult,
  ApprovalRequest,
  TaskStatus,
} from '../lib/types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8001';
const USE_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

// ── Real API client ────────────────────────────────────────────────────────

async function apiGet(path: string, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path: string, body: any, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_MODELS: ModelEntry[] = [
  { id: 'planner', name: 'qwen2.5:7b-instruct-q4_K_M', role: 'general_reasoning_and_planning', task_types: ['planning', 'general_reasoning'], state: 'unavailable', intelligence: 85, reliability: 80, speed: 55, resident: true, vram_usage_mb: 4700 },
  { id: 'coder', name: 'qwen2.5-coder:7b-instruct-q4_K_M', role: 'code_generation_and_execution', task_types: ['code_execution'], state: 'unavailable', intelligence: 80, reliability: 75, speed: 55, resident: false, vram_usage_mb: 4700 },
  { id: 'vision', name: 'moondream', role: 'image_layout_and_diagrams', task_types: ['vision_ocr'], state: 'unavailable', intelligence: 45, reliability: 70, speed: 85, resident: false, vram_usage_mb: 1700 },
  { id: 'embedder', name: 'bge-small-en-v1.5', role: '', task_types: ['rag_retrieval'], state: 'loaded', intelligence: 60, reliability: 90, speed: 95, resident: true, vram_usage_mb: 0 },
  { id: 'sandbox', name: 'Sandbox Runner', role: 'Isolated Code Execution', task_types: ['code_execution'], state: 'loaded', intelligence: 0, reliability: 100, speed: 100, resident: true, vram_usage_mb: 0 },
];

const MOCK_STATS: Record<string, ModelStats> = {
  'qwen2.5:7b-instruct-q4_K_M': { requests: 1247, success_rate: 94.2, avg_latency_ms: 1820, task_types: { planning: 420, general_reasoning: 827 } },
  'qwen2.5-coder:7b-instruct-q4_K_M': { requests: 389, success_rate: 88.7, avg_latency_ms: 2100, task_types: { code_execution: 389 } },
  moondream: { requests: 156, success_rate: 96.2, avg_latency_ms: 650, task_types: { vision_ocr: 156 } },
};

const MOCK_AUDIT: AuditEntry[] = [
  { timestamp: '2026-09-28T12:00:00Z', task_id: 'a1b2c3d4', step_type: 'task_submitted', model_used: '', duration_ms: 0, input_summary: 'Draft compliance report', output_summary: '', status: 'success', user: 'admin' },
  { timestamp: '2026-09-28T12:01:00Z', task_id: 'a1b2c3d4', step_type: 'planner', model_used: 'qwen2.5:7b-instruct-q4_K_M', duration_ms: 3400, input_summary: 'Planning subtasks', output_summary: '3 subtasks generated', status: 'success', user: 'admin' },
  { timestamp: '2026-09-28T12:02:00Z', task_id: 'a1b2c3d4', step_type: 'execute_rag_retrieval', model_used: '', duration_ms: 200, input_summary: 'Search knowledge base', output_summary: 'Found 5 documents', status: 'success', user: 'admin' },
  { timestamp: '2026-09-28T12:03:00Z', task_id: 'a1b2c3d4', step_type: 'approval', model_used: '', duration_ms: 0, input_summary: 'Waiting for approval', output_summary: 'Awaiting operator decision', status: 'success', user: 'admin' },
  { timestamp: '2026-09-28T12:05:00Z', task_id: 'a1b2c3d4', step_type: 'synthesize_deliverable', model_used: 'qwen2.5:7b-instruct-q4_K_M', duration_ms: 12000, input_summary: 'Generate final report', output_summary: 'Report generated', status: 'success', user: 'admin' },
];

const MOCK_VERIFY: AuditVerifyResult = {
  valid: true,
  entries_checked: 142,
  first_invalid_seq: null,
  chain_start_seq: 45,
  legacy_unhashed_entries: 44,
};

const MOCK_APPROVAL: ApprovalRequest = {
  id: 'task-abc123',
  action: 'Execute code in sandbox',
  detail: 'Running python script to generate compliance report from indexed documents',
};

// ── API layer ──────────────────────────────────────────────────────────────

export async function getModels(): Promise<{ models: ModelEntry[] }> {
  if (USE_MOCK) return { models: MOCK_MODELS };
  return apiGet('/api/models');
}

export async function getModelStats(): Promise<{ models: Record<string, ModelStats> }> {
  if (USE_MOCK) return { models: MOCK_STATS };
  return apiGet('/api/models/stats');
}

export async function getRoutingScores(weights?: RoutingWeights): Promise<any> {
  if (USE_MOCK) return { scores: MOCK_MODELS.map(m => ({ id: m.id, score: 75 })) };
  return apiPost('/api/models/routing-scores', weights ?? { speed: 33, reliability: 33, intelligence: 34 });
}

export async function getAuditLog(n = 200): Promise<{ entries: AuditEntry[]; total: number }> {
  if (USE_MOCK) return { entries: MOCK_AUDIT, total: MOCK_AUDIT.length };
  return apiGet(`/api/audit/log?n=${n}`);
}

export async function verifyAuditChain(): Promise<AuditVerifyResult> {
  if (USE_MOCK) return MOCK_VERIFY;
  return apiGet('/api/audit/verify');
}

export async function submitTask(prompt: string, files?: string[]): Promise<any> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 800));
    return { task_id: 'mock-' + Date.now(), status: 'waiting_approval', state: { needs_human_approval: true } };
  }
  return apiPost('/api/tasks/submit', { prompt, files: files ?? [] });
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
  if (USE_MOCK) return { task_id: taskId, status: 'waiting_approval' };
  return apiGet(`/api/tasks/${taskId}/status`) as Promise<TaskStatus>;
}

export async function approveTask(taskId: string, approved: boolean): Promise<any> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 500));
    return { task_id: taskId, status: 'completed' };
  }
  return apiPost(`/api/tasks/${taskId}/approve`, { approved });
}

export async function getUserPreferences(): Promise<any> {
  if (USE_MOCK) return { routing_weights: { speed: 33, reliability: 33, intelligence: 34 } };
  return apiGet('/api/user/preferences');
}

export async function saveUserPreferences(data: any): Promise<void> {
  if (USE_MOCK) return;
  await apiPost('/api/user/preferences', data);
}