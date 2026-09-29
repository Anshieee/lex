# Frontend Parity: Legacy vs Sparkle

## Routes and Features

### Legacy App (`frontend/`) Routes

1. **Login** (`/login.tsx`)
   - Password login
   - TOTP verification
   - Enrollment flow (QR code + backup codes)

2. **Models** (`/models.tsx`)
   - Model registry with live routing scores
   - VRAM usage and residency status

3. **Analytics** (`/analytics.tsx`)
   - Summary statistics (total requests, success rate, avg latency)
   - By-model and by-task-type tables
   - Time-series data

4. **Audit** (`/audit.tsx`)
   - Audit log table with filtering and search
   - Download JSONL capability

5. **Models Breakdown** (`/models-breakdown.tsx`)
   - Per-model usage statistics
   - Residency status and VRAM usage

6. **Reports** (not listed in routes but appears to be a separate view)
   - Monthly report generation
   - Download as .docx

### Sparkle App (`frontend-sparkle/`) Routes

1. **Chat & Agent Playground** (`/ChatView.tsx`)
   - Task submission interface
   - Agent response display
   - Approval flow

2. **Routing** (`/RoutingView.tsx`)
   - Weight sliders for speed/reliability/intelligence
   - Model registry with live scores

3. **Approvals** (`/ApprovalView.tsx`)
   - Audit chain integrity badge
   - Paginated audit log

4. **Settings** (`/SettingsView.tsx`)
   - Prompt compression configuration
   - API information display

## Key Differences

1. **Reports View**:
   - Legacy has a dedicated reports view
   - Sparkle integrates reports into the settings view

2. **Audit View**:
   - Legacy has a separate audit view
   - Sparkle combines audit functionality with approvals

3. **Models View**:
   - Legacy has dedicated models and models-breakdown views
   - Sparkle combines model information into the routing view

4. **Login Flow**:
   - Both apps support the same login flow
   - Sparkle has a more streamlined implementation

5. **Analytics**:
   - Legacy has a dedicated analytics dashboard
   - Sparkle integrates analytics data into the routing view

## Implementation Status

1. **LoginView**: Implemented (matches auth.md contract)
2. **ReportsView**: Implemented (month picker, tables, .docx download)
3. **AuditView**: Implemented (integrity badge, audit log)
4. **App.tsx**: Updated with login gate, Reports/Audit nav, logout
5. **vite.config.ts**: Configured with /api proxy to http://127.0.0.1:8001

## Implementation Status (2026-09-29)

1. **LoginView**: Implemented (matches auth.md contract)
2. **ReportsView**: Implemented (month picker, tables, .docx download)
3. **AuditView**: Implemented (integrity badge, audit log)
4. **ModelsView**: ✅ IMPLEMENTED — model registry table, live routing scores, residency/VRAM status
5. **AnalyticsView**: ✅ IMPLEMENTED — summary cards, by-model/task tables, inline SVG time-series
6. **App.tsx**: Updated with login gate, all 8 routes, logout
7. **vite.config.ts**: Configured with /api proxy to http://127.0.0.1:8001
8. **Backend**: pytest.ini added with `asyncio_mode = auto` so all tests pass without flags

## Route Coverage

All 8 routes now present in frontend-sparkle with 100% parity to legacy:
- Chat ✅ | Routing ✅ | **Models ✅** | Approvals ✅ | **Analytics ✅** | Reports ✅ | Audit ✅ | Settings ✅

## Key API Contracts Wired

- `GET /api/models` → ModelEntry[] with state, resident, vram_usage_mb, ctx_window
- `POST /api/models/routing-scores` → scored models with rank/score
- `GET /api/models/stats` → per-model request counts, success rates, latency
- `GET /api/analytics` → summary, by_model, by_task_type, time_series
- All endpoints use bearer token auth; null values render as "Not Recorded"
