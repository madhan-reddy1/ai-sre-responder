# Incident verdict: INC-1002 — payments-worker OOM restarts

**Service:** payments-worker · **Severity:** SEV-2 · **Detected:** 2026-11-12T11:47:00Z

> ⚠️ **Sample / demo data.** This verdict was produced from the bundled sample incidents and logs. It is not a real production incident.

## Agent trace

### Step 1 — LogAgent
**Thought:** Incident INC-1002 on payments-worker. I need the recent logs first to see what is failing.
**Action:** `get_logs`

### Step 2 — LogAgent
**Observation:** Retrieved 7 log lines; 3 ERROR lines.

### Step 3 — LogAgent
**Thought:** Errors started recently — I should check whether a deploy went out just before them.
**Action:** `get_deploy_status`

### Step 4 — LogAgent
**Observation:** Current version v1.9.2 (deployed 2026-11-10T09:30:00Z), previous v1.9.1.

### Step 5 — LogAgent
**Thought:** Checking errorRate against its baseline.
**Action:** `check_metric`

### Step 6 — LogAgent
**Observation:** errorRate: 1.1% (baseline 0.3%) — elevated.

### Step 7 — LogAgent
**Thought:** Checking p99Latency against its baseline.
**Action:** `check_metric`

### Step 8 — LogAgent
**Observation:** p99Latency: 610ms (baseline 420ms) — normal.

### Step 9 — LogAgent
**Thought:** Checking memoryUsage against its baseline.
**Action:** `check_metric`

### Step 10 — LogAgent
**Observation:** memoryUsage: 92% (baseline 58%) — elevated.

### Step 11 — LogAgent
**Thought:** Checking restarts against its baseline.
**Action:** `check_metric`

### Step 12 — LogAgent
**Observation:** restarts: 7count/1h (baseline 0count/1h) — elevated.

### Step 13 — DiagnosisAgent
**Thought:** I have logs, deploy info, and metrics. Let me match the signals against known failure patterns.
**Action:** `diagnose(evidence)`

### Step 14 — DiagnosisAgent
**Observation:** Diagnosis: memory-leak (confidence high). Memory leak in the batch processor introduced in the recent release: heap usage climbs steadily after each restart until the process is killed with OutOfMemoryError.

### Step 15 — RemediationAgent
**Thought:** Considering fix: purge-queue — Purge the dead-letter queue to free memory. Checking it against the guardrail policy first.
**Action:** `propose_fix`

### Step 16 — RemediationAgent
**Observation:** Guardrail: blocked (high risk). "purge-queue" is high-risk (destructive or irreversible). It must be done by a human, never by the agent.

### Step 17 — RemediationAgent
**Thought:** Considering fix: restart-service — Restart payments-worker now to restore service, then roll back to v1.9.1 out of band. Checking it against the guardrail policy first.
**Action:** `propose_fix`

### Step 18 — RemediationAgent
**Observation:** Guardrail: allowed (low risk). "restart-service" is low-risk (safe and reversible). It may proceed once a human approves.

## Root cause

**Confidence:** high

Memory leak in the batch processor introduced in the recent release: heap usage climbs steadily after each restart until the process is killed with OutOfMemoryError.

Supporting evidence:
- memory 92% vs 58% baseline
- 7 restarts in 1h
- OutOfMemoryError and GC overhead limit in logs

## Proposed fix

- **Action:** `restart-service`
- **Detail:** Restart payments-worker now to restore service, then roll back to v1.9.1 out of band.
- **Risk:** low
- **Guardrail:** allowed — "restart-service" is low-risk (safe and reversible). It may proceed once a human approves.

### Blocked candidates (guardrail)

- `purge-queue` — Purge the dead-letter queue to free memory. **Blocked:** "purge-queue" is high-risk (destructive or irreversible). It must be done by a human, never by the agent.

## Approval status

**Awaiting human approval** — use `node approve.js` to approve or reject. Nothing has been executed.
