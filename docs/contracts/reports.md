# Monthly report

`GET /api/reports/monthly?month=YYYY-MM&format=json|docx` — admin role only
(403 otherwise, 400 on a malformed month, 200 with zeros if the month has no entries).

JSON body:
```
{month, generated_at, source_log, entries_in_month,
 totals: {tasks, completed, failed, success_rate, approvals, rejections},
 by_model: [{model, requests, success_rate, avg_latency_ms, input_tokens, output_tokens}],
 by_task_type: [{task_type, count, success_rate}],
 daily: [{date, tasks, failures}],
 egress: {outbound_connections, source}}
```
`success_rate` is a fraction 0-1 or `null`. Any figure the audit log does not record is
`null`, never estimated. `format=docx` returns the same content as tables plus a summary,
as attachment `lex-report-YYYY-MM.docx`.