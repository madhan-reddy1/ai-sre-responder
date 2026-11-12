// agents.js — multi-agent orchestration with a ReAct-style loop.
//
// Three agents, coordinated by an orchestrator:
//   LogAgent        — gathers evidence (logs, deploy status, metrics)
//   DiagnosisAgent  — reasons over the evidence to find the root cause
//   RemediationAgent— proposes a fix, checked by the guardrail layer
//
// Each agent runs a Thought -> Action (tool call) -> Observation loop.
// The "reasoning" is deterministic and rule-based — no LLM API is called.
// That is deliberate: this project demonstrates the orchestration pattern,
// tool use, and guardrails. A real LLM would replace the rule functions
// (decideNextStep / diagnose / pickFix) with model calls; the loop,
// the tools, and the guardrail checks stay exactly the same.

const { callTool, getIncidents } = require('./tools');
const { evaluate } = require('./guardrails');

const MAX_STEPS = 8;

function step(trace, agent, thought, action, observation) {
  trace.push({ agent, thought, action, observation });
}

// ---------------------------------------------------------------- LogAgent
function runLogAgent(incident, trace) {
  const { service } = incident;
  const evidence = { logs: [], deploy: null, metrics: {} };
  let steps = 0;

  step(trace, 'LogAgent',
    `Incident ${incident.id} on ${service}. I need the recent logs first to see what is failing.`,
    'get_logs', null);
  const logs = callTool('get_logs', { service, limit: 20 });
  evidence.logs = logs.ok ? logs.result.lines : [];
  step(trace, 'LogAgent', null, null,
    `Retrieved ${evidence.logs.length} log lines; ${evidence.logs.filter((l) => l.level === 'ERROR').length} ERROR lines.`);
  steps += 1;

  step(trace, 'LogAgent',
    'Errors started recently — I should check whether a deploy went out just before them.',
    'get_deploy_status', null);
  const deploy = callTool('get_deploy_status', { service });
  evidence.deploy = deploy.ok ? deploy.result : null;
  step(trace, 'LogAgent', null, null,
    evidence.deploy
      ? `Current version ${evidence.deploy.version} (deployed ${evidence.deploy.deployedAt}), previous ${evidence.deploy.previousVersion}.`
      : 'No deploy record found.');
  steps += 1;

  const metricNames = ['errorRate', 'p99Latency', 'memoryUsage', 'restarts'];
  for (const metric of metricNames) {
    if (steps >= MAX_STEPS) break;
    step(trace, 'LogAgent', `Checking ${metric} against its baseline.`, 'check_metric', null);
    const m = callTool('check_metric', { service, metric });
    if (m.ok) {
      evidence.metrics[metric] = m.result;
      step(trace, 'LogAgent', null, null,
        `${metric}: ${m.result.value}${m.result.unit} (baseline ${m.result.baseline}${m.result.unit}) — ${m.result.status}.`);
    }
    steps += 1;
  }
  return evidence;
}

// ---------------------------------------------------------- DiagnosisAgent
function diagnose(incident, evidence) {
  const metrics = evidence.metrics;
  const logs = evidence.logs;
  const logText = logs.map((l) => l.message).join('\n').toLowerCase();

  const errorElevated = metrics.errorRate && ['elevated', 'critical'].includes(metrics.errorRate.status);
  const latencyElevated = metrics.p99Latency && ['elevated', 'critical'].includes(metrics.p99Latency.status);
  const memoryHigh = metrics.memoryUsage && ['elevated', 'critical'].includes(metrics.memoryUsage.status);
  const restarts = metrics.restarts ? metrics.restarts.value : 0;

  // Rule 1: errors spiked right after a deploy + config/null errors in logs.
  if (errorElevated && logText.includes('config') && logText.includes('nullpointer')) {
    return {
      key: 'config-regression',
      rootCause: `Bad config shipped in deploy ${evidence.deploy ? evidence.deploy.version : ''}: the config key payments.retry_limit is missing/null, so PaymentValidator throws NullPointerException and checkout requests fail with HTTP 500.`,
      confidence: 'high',
      evidence: ['errorRate 4.8% vs 0.2% baseline', 'NullPointerException on payments.retry_limit in logs', 'errors began minutes after v2.14.0 deploy'],
    };
  }
  // Rule 2: memory climbing + OOM kills + repeated restarts.
  if (memoryHigh && restarts > 0 && logText.includes('outofmemoryerror')) {
    return {
      key: 'memory-leak',
      rootCause: 'Memory leak in the batch processor introduced in the recent release: heap usage climbs steadily after each restart until the process is killed with OutOfMemoryError.',
      confidence: 'high',
      evidence: ['memory 92% vs 58% baseline', '7 restarts in 1h', 'OutOfMemoryError and GC overhead limit in logs'],
    };
  }
  // Rule 3: latency spike + downstream timeouts + thread pool exhaustion.
  if (latencyElevated && logText.includes('timeout') && logText.includes('inventory-service')) {
    return {
      key: 'downstream-latency',
      rootCause: 'Downstream dependency latency: inventory-service p99 is 3.4s, so orders-api requests time out after 2s and the thread pool exhausts waiting on the downstream.',
      confidence: 'high',
      evidence: ['p99 latency 3800ms vs 420ms baseline', 'timeouts calling inventory-service in logs', 'thread pool 200/200 exhausted'],
    };
  }
  // Fallback: report the strongest single signal.
  const worst = Object.values(metrics).find((m) => m.status === 'critical')
    || Object.values(metrics).find((m) => m.status === 'elevated');
  return {
    key: 'unknown',
    rootCause: worst
      ? `Unclear root cause. Strongest signal is ${worst.metric} at ${worst.value}${worst.unit} (${worst.status} vs baseline ${worst.baseline}${worst.unit}). Needs a human to investigate.`
      : 'No anomalous metric found. Needs a human to investigate.',
    confidence: 'low',
    evidence: [],
  };
}

function runDiagnosisAgent(incident, evidence, trace) {
  step(trace, 'DiagnosisAgent',
    'I have logs, deploy info, and metrics. Let me match the signals against known failure patterns.',
    'diagnose(evidence)', null);
  const diagnosis = diagnose(incident, evidence);
  step(trace, 'DiagnosisAgent', null, null,
    `Diagnosis: ${diagnosis.key} (confidence ${diagnosis.confidence}). ${diagnosis.rootCause}`);
  return diagnosis;
}

// -------------------------------------------------------- RemediationAgent
// Candidate fixes per root-cause key, in the order the agent considers them.
// A candidate that the guardrail blocks is logged in the trace and skipped.
const FIX_CANDIDATES = {
  'config-regression': [
    { action: 'rollback-deploy', detail: 'Roll back checkout-api to v2.13.4 (the last known-good version).' },
  ],
  'memory-leak': [
    { action: 'purge-queue', detail: 'Purge the dead-letter queue to free memory.' },
    { action: 'restart-service', detail: 'Restart payments-worker now to restore service, then roll back to v1.9.1 out of band.' },
  ],
  'downstream-latency': [
    { action: 'enable-circuit-breaker', detail: 'Enable the circuit breaker for inventory-service and raise the call timeout from 2000ms to 5000ms.' },
  ],
  unknown: [],
};

function runRemediationAgent(incident, diagnosis, trace) {
  const candidates = FIX_CANDIDATES[diagnosis.key] || [];
  if (candidates.length === 0) {
    step(trace, 'RemediationAgent',
      'No safe remediation maps to this diagnosis. I will not invent a fix — this goes to a human.',
      'none', 'No fix proposed.');
    return { proposedFix: null, guardrail: null, blockedCandidates: [] };
  }

  const blockedCandidates = [];
  for (const candidate of candidates) {
    step(trace, 'RemediationAgent',
      `Considering fix: ${candidate.action} — ${candidate.detail} Checking it against the guardrail policy first.`,
      'propose_fix', null);
    const res = callTool('propose_fix', {
      incident_id: incident.id,
      action: candidate.action,
      detail: candidate.detail,
    });
    const guardrail = res.ok ? res.result.guardrail : evaluate(candidate.action);
    step(trace, 'RemediationAgent', null, null,
      `Guardrail: ${guardrail.decision} (${guardrail.risk} risk). ${guardrail.reason}`);
    if (guardrail.decision === 'blocked') {
      blockedCandidates.push({ ...candidate, guardrail });
      continue; // try the next, safer candidate
    }
    return { proposedFix: candidate, guardrail, blockedCandidates };
  }
  return { proposedFix: null, guardrail: null, blockedCandidates };
}

// ------------------------------------------------------------ Orchestrator
function orchestrate(incidentId) {
  const incident = getIncidents().find((i) => i.id === incidentId);
  if (!incident) {
    throw new Error(`Unknown incident "${incidentId}". Known: ${getIncidents().map((i) => i.id).join(', ')}.`);
  }
  const trace = [];
  const evidence = runLogAgent(incident, trace);
  const diagnosis = runDiagnosisAgent(incident, evidence, trace);
  const remediation = runRemediationAgent(incident, diagnosis, trace);

  return {
    incident: { id: incident.id, title: incident.title, service: incident.service, severity: incident.severity, detectedAt: incident.detectedAt },
    evidence,
    diagnosis,
    proposedFix: remediation.proposedFix,
    guardrail: remediation.guardrail,
    blockedCandidates: remediation.blockedCandidates,
    trace,
    status: remediation.proposedFix ? 'awaiting-approval' : 'needs-human',
  };
}

module.exports = { orchestrate, runLogAgent, runDiagnosisAgent, runRemediationAgent };
