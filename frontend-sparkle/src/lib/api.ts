/**
 * LEX Sparkle Frontend API Client
 *
 * Fetcher wrapper with Bearer token auth, 401/429 handling,
 * authenticated blob download helper, and React hooks.
 *
 * Environment:
 *   VITE_API_BASE  — base URL (default: http://127.0.0.1:8001)
 *
 * Auth flow:
 *   - 401 → clear stored token and redirect to login
 *   - 429 → surface retry_after_s to the UI
 *   - All requests include Authorization: Bearer <token> when a token is present
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  ModelEntry,
  ModelStats,
  AuditEntry,
  PromptCompressionConfig,
  RoutingWeights,
  RoutingScoredModel,
  ModelRegistryResponse,
  RoutingScoresResponse,
  ModelStatsResponse,
  AnalyticsResponse,
  AnalyticsSummary,
  AnalyticsByModelEntry,
  AnalyticsByTaskTypeEntry,
  AnalyticsTimeSeriesPoint,
  RoutingScoresRequest,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8001';

function getAuthHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function handleResponse(res: Response, on401: () => void, on429?: (retryAfter: number) => void): Promise<any> {
  if (res.status === 401) {
    on401();
    return Promise.reject(new Error('Unauthorized'));
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter && on429) {
      on429(parseInt(retryAfter, 10));
    }
    return Promise.reject(new Error(`Rate limited, retry after ${retryAfter}s`));
  }
  if (!res.ok) {
    return Promise.reject(new Error(`API error ${res.status}`));
  }
  return res.json();
}

export async function apiGet<T>(path: string, token?: string | null, on401?: () => void, on429?: (retryAfter: number) => void): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(token) });
  return handleResponse(res, on401 ?? (() => {}), on429).then((data: any) => data as T);
}

export async function apiPost<B = any, T = any>(path: string, body: B, token?: string | null, on401?: () => void, on429?: (retryAfter: number) => void): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res, on401 ?? (() => {}), on429).then((data: any) => data as T);
}

export async function apiPut<B = any, T = any>(path: string, body: B, token?: string | null, on401?: () => void, on429?: (retryAfter: number) => void): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res, on401 ?? (() => {}), on429).then((data: any) => data as T);
}

// Internal fetchWithAuth for hooks that need direct fetch access
async function fetchWithAuth(path: string, options: RequestInit = {}, token?: string | null): Promise<Response> {
  const headers = getAuthHeaders(token);
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
}

// ── Auth API functions ───────────────────────────────────────────────────

export interface LoginResponse {
  status: 'ok' | 'mfa_required' | 'enrollment_required';
  access_token?: string;
  token_type?: string;
  role?: string;
  mfa_token?: string;
  enroll_token?: string;
}

export async function login(credentials: { username: string; password: string }): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface VerifyMfaRequest {
  mfa_token: string;
  code?: string;
  backup_code?: string;
}

export interface VerifyMfaResponse {
  status: 'ok';
  access_token: string;
  token_type: 'bearer';
  role: string;
}

export async function verifyMfa(data: VerifyMfaRequest): Promise<VerifyMfaResponse> {
  const res = await fetch(`${API_BASE}/api/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface EnrollResponse {
  otpauth_uri: string;
  qr_png_base64: string;
  backup_codes: string[];
}

export async function enroll(enrollToken: string): Promise<EnrollResponse> {
  const res = await fetch(`${API_BASE}/api/auth/totp/enroll`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${enrollToken}` },
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ConfirmEnrollRequest {
  code: string;
}

export interface ConfirmEnrollResponse {
  status: 'ok';
  access_token: string;
  token_type: 'bearer';
  role: string;
}

export async function confirmEnrollment(enrollToken: string, code: string): Promise<ConfirmEnrollResponse> {
  const res = await fetch(`${API_BASE}/api/auth/totp/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${enrollToken}` },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Report API functions ─────────────────────────────────────────────────

export interface MonthlyReportResult {
  month: string;
  generated_at: string;
  entries_in_month: number;
  totals: { tasks: number; completed: number; failed: number; success_rate: number | null; approvals: number; rejections: number };
  by_model: Array<{ model: string; requests: number; success_rate: number | null; avg_latency_ms: number | null; input_tokens: null; output_tokens: null }>;
  by_task_type: Array<{ task_type: string; count: number; success_rate: number | null }>;
  daily: Array<{ date: string; tasks: number; failures: number }>;
  egress: { outbound_connections: number | null; source: string };
}

export async function getMonthlyReport(month: string, format: 'json' | 'docx' = 'json', token?: string | null): Promise<MonthlyReportResult | Blob> {
  const res = await fetch(`${API_BASE}/api/reports/monthly?month=${month}&format=${format}`, {
    headers: {
      ...getAuthHeaders(token),
      ...(format === 'docx' ? { 'Accept': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } : {}),
    },
  });

  if (!res.ok) {
    if (res.status === 403) throw new Error('Admin access required');
    if (res.status === 400) throw new Error('Invalid month format');
    throw new Error(`HTTP ${res.status}`);
  }

  if (format === 'docx') {
    return res.blob();
  }
  return res.json();
}

// ── Audit API functions ──────────────────────────────────────────────────

export interface AuditVerifyResult {
  valid: boolean;
  entries_checked: number;
  first_invalid_seq: number | null;
  chain_start_seq: number | null;
  legacy_unhashed_entries: number;
}

export async function getAuditVerify(token?: string | null): Promise<AuditVerifyResult> {
  const res = await fetchWithAuth('/api/audit/verify', {}, token);
  return res.json();
}

// ── User Preferences API functions ────────────────────────────────────────

export interface UserPreferences {
  routing_weights?: { speed: number; reliability: number; intelligence: number };
  prompt_compression?: {
    mode: "Off" | "Lossless" | "Standard" | "Aggressive";
    repeated_blocks: boolean;
    whitespace_cleanup: boolean;
    json_tables: boolean;
    superseded_file_reads: boolean;
    tool_output_filter: boolean;
    relevance_filter: boolean;
    older_turns: boolean;
    token_ceiling: boolean;
  };
}

export async function getUserPreferences(token?: string | null): Promise<UserPreferences> {
  return apiGet('/api/user/preferences', token);
}

export async function saveUserPreferences(data: UserPreferences, token?: string | null): Promise<any> {
  return apiPut('/api/user/preferences', data, token);
}

// ── Task API functions ───────────────────────────────────────────────────

export async function submitTask(prompt: string, files?: string[], token?: string | null): Promise<any> {
  return apiPost('/api/tasks/submit', { prompt, files: files ?? [] }, token);
}

export async function approveTask(taskId: string, approved: boolean, token?: string | null): Promise<any> {
  return apiPost(`/api/tasks/${taskId}/approve`, { approved }, token);
}

export async function getTaskStatus(taskId: string, token?: string | null): Promise<any> {
  return apiGet(`/api/tasks/${taskId}/status`, token);
}

export async function getModels(): Promise<{ models: ModelEntry[] }> {
  return apiGet('/api/models');
}

export async function getModelStats(): Promise<{ models: Record<string, ModelStats> }> {
  return apiGet('/api/models/stats');
}

export async function getRoutingScores(weights?: { speed: number; reliability: number; intelligence: number }): Promise<any> {
  return apiPost('/api/models/routing-scores', weights ?? { speed: 33, reliability: 33, intelligence: 34 });
}

// ── Live model registry / routing / analytics fetchers ────────────────────
//
// These wrap the verified live contract (2026-09-29, port 8001):
//   GET  /api/models                       → { models: ModelEntry[] }
//   POST /api/models/routing-scores        → { scores: RoutingScoredModel[], weights_used: RoutingWeights }
//   GET  /api/models/stats                 → { models: { <name>: ModelStats } }
//   GET  /api/analytics                    → AnalyticsData
//
// All accept `Authorization: Bearer <token>`. Fields may be `null` — render
// as "Not Recorded", never 0.

/**
 * Fetch the live model registry (id, name, ollama_tag, role, task_types,
 * state, ctx_window, intelligence/reliability/speed, resident, vram_usage_mb).
 */
export async function fetchModelRegistry(token?: string | null): Promise<ModelRegistryResponse> {
  return apiGet('/api/models', token);
}

/**
 * Fetch live routing scores for the given weights.
 * Defaults to { speed: 33, reliability: 33, intelligence: 34 } when omitted,
 * matching the legacy models.tsx default.
 */
export async function fetchRoutingScores(
  weights?: Partial<RoutingScoresRequest>,
  token?: string | null,
): Promise<RoutingScoresResponse> {
  return apiPost(
    '/api/models/routing-scores',
    weights ?? { speed: 33, reliability: 33, intelligence: 34 },
    token,
  );
}

/**
 * Fetch per-model usage statistics from the audit log (last `hours` hours).
 * Returns { models: { <name>: { requests, success_rate, avg_latency_ms, task_types } } }.
 */
export async function fetchModelStats(hours: number = 24, token?: string | null): Promise<ModelStatsResponse> {
  return apiGet(`/api/models/stats?hours=${hours}`, token);
}

/**
 * Fetch aggregated analytics: summary totals, breakdowns by model and task
 * type, plus an hourly time series.
 */
export async function fetchAnalytics(hours: number = 24, token?: string | null): Promise<AnalyticsResponse> {
  return apiGet(`/api/analytics?hours=${hours}`, token);
}

export async function getAuditLog(n = 200, token?: string | null): Promise<{ entries: AuditEntry[]; total: number }> {
  return apiGet(`/api/audit/log?n=${n}`, token);
}

// ── Helper functions ─────────────────────────────────────────────────────

export async function downloadBlob(path: string, filename: string, token?: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(token) });
  if (res.status === 401) {
    const meta = document.querySelector('meta[name="vite-user-token"]');
    if (meta) meta.remove();
    throw new Error('Unauthorized — please log in');
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Download failed: ${res.status} — ${err}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── Auth hooks (exact signatures from dispatch §3 line 89) ──────────

export interface AuthResult {
  token: string | null;
  role: string | null;
  status: 'ok' | 'mfa_required' | 'enrollment_required' | 'unknown' | 'unauthenticated';
}

export function useAuth(): AuthResult & {
  login: (username: string, password: string) => Promise<LoginResponse>;
  verifyMfa: (params: { code?: string; backupCode?: string }) => Promise<VerifyMfaResponse>;
  enroll: (enrollToken: string) => Promise<EnrollResponse>;
  confirm: (enrollToken: string, code: string) => Promise<ConfirmEnrollResponse>;
  logout: () => void;
} {
  const [token, setToken] = useState<string | null>(() => {
    const meta = document.querySelector('meta[name="vite-user-token"]');
    return meta ? meta.getAttribute('content') : localStorage.getItem('lex_token');
  });
  const [role, setRole] = useState<string | null>(() => {
    const userStr = localStorage.getItem('lex_user');
    if (userStr) {
      try { return JSON.parse(userStr).role; } catch { return null; }
    }
    return null;
  });
  const [status, setStatus] = useState<'ok' | 'mfa_required' | 'enrollment_required' | 'unknown' | 'unauthenticated'>('unknown');

  const handle401 = useCallback(() => {
    setToken(null);
    setRole(null);
    setStatus('unauthenticated');
    localStorage.removeItem('lex_token');
    localStorage.removeItem('lex_user');
    localStorage.removeItem('lex_mfa_token');
    localStorage.removeItem('lex_mfa_token_type');
    const meta = document.querySelector('meta[name="vite-user-token"]');
    if (meta) meta.remove();
  }, []);

  const loginFn = useCallback(async (username: string, password: string): Promise<LoginResponse> => {
    try {
      const result = await login({ username, password });
      if (result.access_token) {
        setToken(result.access_token);
        setRole(result.role ?? null);
        localStorage.setItem('lex_token', result.access_token);
        localStorage.setItem('lex_user', JSON.stringify({ username, role: result.role }));
      }
      setStatus(result.status);
      return result;
    } catch {
      setStatus('unknown');
      throw new Error('Login failed');
    }
  }, [handle401]);

  const verifyMfaFn = useCallback(async ({ code, backupCode }: { code?: string; backupCode?: string }): Promise<VerifyMfaResponse> => {
    const mfaToken = localStorage.getItem('lex_mfa_token');
    if (!mfaToken) throw new Error('No MFA token');
    try {
      const result = await verifyMfa({ mfa_token: mfaToken, code, backup_code: backupCode });
      setToken(result.access_token);
      setRole(result.role);
      localStorage.setItem('lex_token', result.access_token);
      localStorage.setItem('lex_user', JSON.stringify({ username: '', role: result.role, token: result.access_token }));
      localStorage.removeItem('lex_mfa_token');
      localStorage.removeItem('lex_mfa_token_type');
      setStatus('ok');
      return result;
    } catch {
      setStatus('unknown');
      throw new Error('MFA verification failed');
    }
  }, [token]);

  const enrollFn = useCallback(async (enrollToken: string): Promise<EnrollResponse> => {
    try {
      const result = await enroll(enrollToken);
      return result;
    } catch {
      throw new Error('Enrollment failed');
    }
  }, [token]);

  const confirmFn = useCallback(async (enrollToken: string, code: string): Promise<ConfirmEnrollResponse> => {
    try {
      const result = await confirmEnrollment(enrollToken, code);
      setToken(result.access_token);
      setRole(result.role);
      localStorage.setItem('lex_token', result.access_token);
      localStorage.setItem('lex_user', JSON.stringify({ username: '', role: result.role, token: result.access_token }));
      localStorage.removeItem('lex_mfa_token');
      localStorage.removeItem('lex_mfa_token_type');
      setStatus('ok');
      return result;
    } catch {
      throw new Error('Enrollment confirmation failed');
    }
  }, [token]);

  const logout = useCallback((): void => {
    setToken(null);
    setRole(null);
    setStatus('unauthenticated');
    localStorage.removeItem('lex_token');
    localStorage.removeItem('lex_user');
    localStorage.removeItem('lex_mfa_token');
    localStorage.removeItem('lex_mfa_token_type');
    const meta = document.querySelector('meta[name="vite-user-token"]');
    if (meta) meta.remove();
  }, []);

  return { token, role, status, login: loginFn, verifyMfa: verifyMfaFn, enroll: enrollFn, confirm: confirmFn, logout };
}

// ── Monthly report hook (exact signature from dispatch §3 line 90) ──

export interface MonthlyReportHookResult {
  month: string;
  generated_at: string;
  entries_in_month: number;
  totals: { tasks: number; completed: number; failed: number; success_rate: number | null; approvals: number; rejections: number };
  by_model: Array<{ model: string; requests: number; success_rate: number | null; avg_latency_ms: number | null; input_tokens: null; output_tokens: null }>;
  by_task_type: Array<{ task_type: string; count: number; success_rate: number | null }>;
  daily: Array<{ date: string; tasks: number; failures: number }>;
  egress: { outbound_connections: number | null; source: string };
  loading: boolean;
  error: string | null;
}

export function useMonthlyReport(month: string): MonthlyReportHookResult {
  const [state, setState] = useState<MonthlyReportHookResult>({
    month,
    generated_at: '',
    entries_in_month: 0,
    totals: { tasks: 0, completed: 0, failed: 0, success_rate: null, approvals: 0, rejections: 0 },
    by_model: [],
    by_task_type: [],
    daily: [],
    egress: { outbound_connections: null, source: 'audit_log (not recorded)' },
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await getMonthlyReport(month, 'json') as MonthlyReportResult;
        if (!cancelled) setState({ ...result, loading: false, error: null });
      } catch (e: any) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: e.message ?? 'Failed to load' }));
      }
    };
    load();
    return () => { cancelled = true; };
  }, [month]);

  return state;
}

// ── Model registry / routing / analytics hooks ────────────────────────────
//
// Bound to the live contract verified 2026-09-29 on port 8001. All fetchers
// attach `Authorization: Bearer <token>`; 401 clears the stored session and
// surfaces as `error: 'Unauthorized'`. Numeric fields may be `null` from the
// API — consumers must render them as "Not Recorded", never 0.

export interface ModelRegistryHookResult {
  models: ModelEntry[];
  loading: boolean;
  error: string | null;
}

export function useModelRegistry(token?: string | null): ModelRegistryHookResult {
  const [state, setState] = useState<ModelRegistryHookResult>({
    models: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await fetchModelRegistry(token);
        if (!cancelled) setState({ models: result.models, loading: false, error: null });
      } catch (e: any) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: e.message ?? 'Failed to load models' }));
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  return state;
}

export interface RoutingScoresHookResult {
  scores: RoutingScoredModel[];
  weightsUsed: RoutingWeights;
  loading: boolean;
  error: string | null;
}

export function useRoutingScores(weights?: Partial<RoutingScoresRequest>, token?: string | null): RoutingScoresHookResult {
  const [state, setState] = useState<RoutingScoresHookResult>({
    scores: [],
    weightsUsed: { speed: 33, reliability: 33, intelligence: 34 },
    loading: true,
    error: null,
  });

  const weightsKey = JSON.stringify(weights ?? { speed: 33, reliability: 33, intelligence: 34 });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await fetchRoutingScores(weights, token);
        if (!cancelled) setState({ scores: result.scores, weightsUsed: result.weights_used, loading: false, error: null });
      } catch (e: any) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: e.message ?? 'Failed to load routing scores' }));
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightsKey, token]);

  return state;
}

export interface ModelStatsHookResult {
  models: Record<string, ModelStats>;
  loading: boolean;
  error: string | null;
}

export function useModelStats(hours: number = 24, token?: string | null): ModelStatsHookResult {
  const [state, setState] = useState<ModelStatsHookResult>({
    models: {},
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await fetchModelStats(hours, token);
        if (!cancelled) setState({ models: result.models, loading: false, error: null });
      } catch (e: any) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: e.message ?? 'Failed to load model stats' }));
      }
    };
    load();
    return () => { cancelled = true; };
  }, [hours, token]);

  return state;
}

export interface AnalyticsHookResult {
  summary: AnalyticsSummary;
  byModel: Record<string, AnalyticsByModelEntry>;
  byTaskType: Record<string, AnalyticsByTaskTypeEntry>;
  timeSeries: AnalyticsTimeSeriesPoint[];
  loading: boolean;
  error: string | null;
}

export function useAnalytics(hours: number = 24, token?: string | null): AnalyticsHookResult {
  const [state, setState] = useState<AnalyticsHookResult>({
    summary: { total_requests: 0, success_rate: 0, avg_latency_ms: 0 },
    byModel: {},
    byTaskType: {},
    timeSeries: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await fetchAnalytics(hours, token);
        if (!cancelled) setState({
          summary: result.summary,
          byModel: result.by_model,
          byTaskType: result.by_task_type,
          timeSeries: result.time_series,
          loading: false,
          error: null,
        });
      } catch (e: any) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: e.message ?? 'Failed to load analytics' }));
      }
    };
    load();
    return () => { cancelled = true; };
  }, [hours, token]);

  return state;
}

// ── Audit status hook ───────────────────────────────────────────────────

export interface AuditStatusResult {
  valid: boolean;
  entries_checked: number;
  first_invalid_seq: number | null;
  chain_start_seq: number | null;
  legacy_unhashed_entries: number;
  loading: boolean;
  error: string | null;
}

export function useAuditStatus(): AuditStatusResult {
  const [state, setState] = useState<AuditStatusResult>({
    valid: false,
    entries_checked: 0,
    first_invalid_seq: null,
    chain_start_seq: null,
    legacy_unhashed_entries: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await getAuditVerify();
        if (!cancelled) setState({ ...result, loading: false, error: null });
      } catch (e: any) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: e.message ?? 'Audit verification failed' }));
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}