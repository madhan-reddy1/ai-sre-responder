// guardrails.js — policy layer for remediation actions.
//
// Every proposed remediation is evaluated before it can be approved.
// Risk tiers:
//   low    — safe, reversible (restart, timeout bump, circuit breaker)
//   medium — service-affecting but reversible (rollback, scale)
//   high   — destructive or irreversible (delete data, rotate secrets, scale to zero)
// Unknown actions are denied by default: the guardrail never fails open.

const ACTION_RISK = {
  // Low risk — safe and reversible
  'restart-service': 'low',
  'increase-timeout': 'low',
  'enable-circuit-breaker': 'low',
  'clear-cache': 'low',
  // Medium risk — service-affecting but reversible
  'rollback-deploy': 'medium',
  'scale-replicas': 'medium',
  'drain-node': 'medium',
  // High risk — destructive or irreversible, human only
  'delete-data': 'high',
  'purge-queue': 'high',
  'rotate-secret': 'high',
  'scale-to-zero': 'high',
  'drop-table': 'high',
  'delete-namespace': 'high',
};

const DECISION_TEXT = {
  allowed: 'ALLOWED — may proceed once a human approves.',
  'requires-approval': 'REQUIRES APPROVAL — service-affecting; a human must approve.',
  blocked: 'BLOCKED — high-risk action. Human only; the agent may not propose this as the fix.',
};

/**
 * Evaluate a remediation action.
 * @param {string} action - action name, e.g. 'rollback-deploy'
 * @returns {{action, risk, decision, reason}}
 */
function evaluate(action) {
  const risk = ACTION_RISK[action];
  if (!risk) {
    return {
      action,
      risk: 'unknown',
      decision: 'blocked',
      reason: `Unknown action "${action}" — not in the approved action catalog. Denied by default.`,
    };
  }
  if (risk === 'high') {
    return {
      action,
      risk,
      decision: 'blocked',
      reason: `"${action}" is high-risk (destructive or irreversible). It must be done by a human, never by the agent.`,
    };
  }
  if (risk === 'medium') {
    return {
      action,
      risk,
      decision: 'requires-approval',
      reason: `"${action}" is medium-risk (service-affecting but reversible). It needs explicit human approval.`,
    };
  }
  return {
    action,
    risk,
    decision: 'allowed',
    reason: `"${action}" is low-risk (safe and reversible). It may proceed once a human approves.`,
  };
}

function listPolicies() {
  return Object.entries(ACTION_RISK).map(([action, risk]) => ({ action, risk }));
}

module.exports = { ACTION_RISK, DECISION_TEXT, evaluate, listPolicies };
