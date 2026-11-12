# Incident verdict: INC-1001 — checkout-api 5xx spike after deploy

**Service:** checkout-api · **Severity:** SEV-2 · **Detected:** 2026-11-12T14:09:00Z

> ⚠️ **Sample / demo data.** This verdict was produced from the bundled sample incidents and logs. It is not a real production incident.

## Agent trace

### Step 1 — LogAgent
**Thought:** Incident INC-1001 on checkout-api. I need the recent logs first to see what is failing.
**Action:** `get_logs`

### Step 2 — LogAgent
**Observation:** Retrieved 7 log lines; 4 ERROR lines.

### Step 3 — LogAgent
**Thought:** Errors started recently — I should check whether a deploy went out just before them.
**Action:** `get_deploy_status`

### Step 4 — LogAgent
**Observation:** Current version v2.14.0 (deployed 2026-11-12T14:02:00Z), previous v2.13.4.

### Step 5 — LogAgent
**Thought:** Checking errorRate against its baseline.
**Action:** `check_metric`

### Step 6 — LogAgent
**Observation:** errorRate: 4.8% (baseline 0.2%) — critical.

### Step 7 — LogAgent
**Thought:** Checking p99Latency against its baseline.
**Action:** `check_metric`

### Step 8 — LogAgent
**Observation:** p99Latency: 2400ms (baseline 380ms) — critical.

### Step 9 — LogAgent
**Thought:** Checking memoryUsage against its baseline.
**Action:** `check_metric`

### Step 10 — LogAgent
**Observation:** memoryUsage: 54% (baseline 51%) — normal.

### Step 11 — LogAgent
**Thought:** Checking restarts against its baseline.
**Action:** `check_metric`

### Step 12 — LogAgent
**Observation:** restarts: 0count/1h (baseline 0count/1h) — normal.

### Step 13 — DiagnosisAgent
**Thought:** I have logs, deploy info, and metrics. Let me match the signals against known failure patterns.
**Action:** `diagnose(evidence)`

### Step 14 — DiagnosisAgent
**Observation:** Diagnosis: config-regression (confidence high). Bad config shipped in deploy v2.14.0: the config key payments.retry_limit is missing/null, so PaymentValidator throws NullPointerException and checkout requests fail with HTTP 500.

### Step 15 — RemediationAgent
**Thought:** Considering fix: rollback-deploy — Roll back checkout-api to v2.13.4 (the last known-good version). Checking it against the guardrail policy first.
**Action:** `propose_fix`

### Step 16 — RemediationAgent
**Observation:** Guardrail: requires-approval (medium risk). "rollback-deploy" is medium-risk (service-affecting but reversible). It needs explicit human approval.

## Root cause

**Confidence:** high

Bad config shipped in deploy v2.14.0: the config key payments.retry_limit is missing/null, so PaymentValidator throws NullPointerException and checkout requests fail with HTTP 500.

Supporting evidence:
- errorRate 4.8% vs 0.2% baseline
- NullPointerException on payments.retry_limit in logs
- errors began minutes after v2.14.0 deploy

## Proposed fix

- **Action:** `rollback-deploy`
- **Detail:** Roll back checkout-api to v2.13.4 (the last known-good version).
- **Risk:** medium
- **Guardrail:** requires-approval — "rollback-deploy" is medium-risk (service-affecting but reversible). It needs explicit human approval.

## Approval status

**Awaiting human approval** — use `node approve.js` to approve or reject. Nothing has been executed.
