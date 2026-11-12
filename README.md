# 🤖 AI SRE Incident Responder

A multi-agent incident responder built the way real AI SRE tooling works: **MCP-style tools, a ReAct orchestration loop, guardrails, and human-in-the-loop approval** — with zero cloud accounts, zero API keys, and zero dashboards.

When an incident comes in, a small agent team triages it:

1. **LogAgent** pulls logs, deploy status, and metrics.
2. **DiagnosisAgent** matches the evidence against known failure patterns and names the root cause.
3. **RemediationAgent** proposes a fix — but only after the **guardrail layer** clears it.
4. A **human approves or rejects** the fix. Nothing is ever executed automatically.

## Why this exists

On-call teams lose the most time in the first 15 minutes of an incident: finding the right logs, figuring out what changed, and deciding what is safe to do. This project shows that workflow as an agent system — and shows the two parts that matter most in production: **guardrails** (the agent cannot do destructive things) and **HITL** (a human owns the final call).

## Architecture

```text
Incident (INC-1001)
      │
      ▼
┌─────────────┐   tools/call    ┌──────────────────┐
│ Orchestrator│ ──────────────▶ │  MCP-style tool  │
│  (agents.js)│ ◀────────────── │  server (tools)  │
└──────┬──────┘   observations  └──────────────────┘
       │
       ├─ LogAgent        → get_logs, get_deploy_status, check_metric
       ├─ DiagnosisAgent  → rule-based root-cause matching
       └─ RemediationAgent→ propose_fix → guardrails.js
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  approve.js (HITL)│
                              │  approved-plan.json│
                              │  (PLAN ONLY)       │
                              └──────────────────┘
```

Each agent runs a **ReAct loop**: Thought → Action (tool call) → Observation, repeating until it has what it needs. Every step is written into the verdict report, so the whole investigation is auditable.

## MCP-style tools

The tool server (`server.js` + `tools.js`) exposes tools as `{name, description, inputSchema, handler}` — the same shape MCP uses — and a JSON-RPC-style dispatcher for `tools/list` and `tools/call`:

| Tool | What it does |
|---|---|
| `get_logs` | Recent log lines for a service, optionally by level |
| `get_deploy_status` | Current version, deploy time, previous version |
| `get_recent_incidents` | Recent incidents for a service |
| `check_metric` | A metric vs its baseline (`normal` / `elevated` / `critical`) |
| `propose_fix` | Register a fix and get the guardrail decision for it |

Try the dispatcher directly:

```bash
node server.js --list
node server.js --call get_logs --args '{"service":"checkout-api"}'
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_metric","arguments":{"service":"checkout-api","metric":"errorRate"}}}' | node server.js
```

The tools read from `sample-data/` (local JSON), so everything runs offline. Swapping in a real backend means replacing the handler bodies; the registry, schemas, and dispatcher stay the same. A production MCP deployment would wrap this registry in the MCP SDK's stdio/SSE transport.

## Guardrails

`guardrails.js` is a policy layer that evaluates every proposed action by risk:

| Risk | Actions | Decision |
|---|---|---|
| Low | restart-service, increase-timeout, enable-circuit-breaker, clear-cache | Allowed once a human approves |
| Medium | rollback-deploy, scale-replicas, drain-node | Requires explicit human approval |
| High | delete-data, purge-queue, rotate-secret, scale-to-zero, drop-table | **Blocked** — human only, the agent may not propose it |
| Unknown | anything not in the catalog | **Blocked** — denied by default |

The guardrail never fails open: an unknown action is blocked, and a blocked candidate is logged in the trace while the agent falls back to a safer fix.

## Human-in-the-loop

The responder only *proposes*. A human approves or rejects:

```bash
node approve.js --list
node approve.js --approve INC-1001
node approve.js --reject INC-1002
```

Approved fixes are written to `reports/approved-plan.json`, marked **PLAN ONLY — NOT EXECUTED**. Applying a plan to real infrastructure is a separate, human-owned step outside this tool.

## Sample incidents

Three realistic incidents ship in `sample-data/`:

| ID | Incident | Root cause the agents find |
|---|---|---|
| INC-1001 | checkout-api 5xx spike after deploy | Bad config in v2.14.0 (`payments.retry_limit` missing) → rollback (medium risk) |
| INC-1002 | payments-worker OOM restarts | Memory leak in the batch processor → restart service (low risk); a risky "purge queue" shortcut is blocked by the guardrail |
| INC-1003 | orders-api timeouts | Downstream inventory-service latency → enable circuit breaker + raise timeout (low risk) |

## Prerequisites

- Node.js 18+ (zero runtime dependencies)

## Setup

```bash
git clone https://github.com/madhan-reddy1/ai-sre-responder.git
cd ai-sre-responder
```

No install step needed — there are no dependencies.

## Usage

```bash
# Run the responder for one incident
node respond.js INC-1001

# Run it for all sample incidents
node respond.js --all

# Review and approve / reject
node approve.js --list
node approve.js --approve INC-1001
```

Each run writes a verdict report to `reports/incident-<id>-verdict.md` with the full agent trace, root cause, proposed fix, guardrail decision, and approval status.

## Example verdict (INC-1001, abridged)

```markdown
# Incident verdict: INC-1001 — checkout-api 5xx spike after deploy

## Agent trace
### Step 1 — LogAgent
**Thought:** Incident INC-1001 on checkout-api. I need the recent logs first...
**Action:** `get_logs`
**Observation:** Retrieved 7 log lines; 4 ERROR lines.

## Root cause
**Confidence:** high
Bad config shipped in deploy v2.14.0: the config key payments.retry_limit
is missing/null, so PaymentValidator throws NullPointerException and
checkout requests fail with HTTP 500.

## Proposed fix
- **Action:** `rollback-deploy`
- **Detail:** Roll back checkout-api to v2.13.4 (the last known-good version).
- **Risk:** medium
- **Guardrail:** requires-approval — "rollback-deploy" is medium-risk
  (service-affecting but reversible). It needs explicit human approval.
```

## Swapping in a real LLM + real MCP SDK

The ReAct loop is deliberately deterministic and rule-based here, so the project runs with no model and no key. To make it "real":

1. Replace the rule functions in `agents.js` (`diagnose`, `FIX_CANDIDATES`) with LLM calls — the Thought/Action/Observation loop, the tool calls, and the guardrail checks stay unchanged.
2. Replace the handler bodies in `tools.js` with calls to your logging/metrics/deploy APIs.
3. Wrap the registry in the MCP SDK (`@modelcontextprotocol/sdk`) for stdio/SSE transport instead of the built-in dispatcher.

## Project structure

```text
.
├── server.js               # MCP-style tool registry + JSON-RPC dispatcher
├── tools.js                # get_logs, get_deploy_status, get_recent_incidents,
│                           # check_metric, propose_fix (against sample data)
├── agents.js               # LogAgent, DiagnosisAgent, RemediationAgent + orchestrator
├── guardrails.js           # Risk policy: allow / requires-approval / blocked
├── respond.js              # CLI: run the pipeline, write verdict reports
├── approve.js              # CLI: HITL approve/reject, writes approved-plan.json
├── sample-data/
│   ├── incidents.json      # 3 sample incidents
│   └── logs.json           # Sample logs per service
├── reports/                # Generated verdict reports (sample included)
└── .github/workflows/ci.yml
```

## Skills demonstrated

- **MCP** — tool registry + schemas + dispatcher in MCP shape
- **Multi-agent orchestration** — Log / Diagnosis / Remediation agents coordinated by an orchestrator
- **ReAct** — Thought → Action → Observation loop with a visible trace
- **Tool orchestration** — agents call tools and reason over observations
- **Guardrails** — risk-tiered policy that blocks destructive actions and never fails open
- **HITL** — human approval before any remediation; plans are PLAN ONLY
