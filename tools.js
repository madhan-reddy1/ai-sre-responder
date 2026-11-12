// tools.js — MCP-style tool registry.
//
// Each tool is a plain object in the MCP spirit: a name, a human-readable
// description, a JSON input schema, and a handler. The handlers read from the
// local sample dataset (sample-data/*.json), so everything runs offline with
// no cloud account and no API key. Swapping in a real backend means replacing
// the handler bodies — the registry, schemas, and dispatcher stay the same.

const fs = require('fs');
const path = require('path');
const { evaluate } = require('./guardrails');

const DATA_DIR = path.join(__dirname, 'sample-data');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

function getIncidents() {
  return loadJson('incidents.json');
}

function getLogs() {
  return loadJson('logs.json');
}

function statusOf(value, baseline) {
  if (baseline === 0) return value > 0 ? 'elevated' : 'normal';
  const ratio = value / baseline;
  if (ratio >= 5) return 'critical';
  if (ratio >= 1.5) return 'elevated';
  return 'normal';
}

const TOOLS = [
  {
    name: 'get_logs',
    description: 'Fetch recent log lines for a service, optionally filtered by level.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name, e.g. checkout-api' },
        level: { type: 'string', description: 'Optional log level filter: ERROR, WARN, INFO' },
        limit: { type: 'number', description: 'Max lines to return (default 20)' },
      },
      required: ['service'],
    },
    run({ service, level, limit = 20 }) {
      const all = (getLogs()[service] || []).filter(
        (l) => !level || l.level === level
      );
      return { service, count: all.length, lines: all.slice(-limit) };
    },
  },
  {
    name: 'get_deploy_status',
    description: 'Get the current deploy for a service: version, deploy time, previous version.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name' },
      },
      required: ['service'],
    },
    run({ service }) {
      const inc = getIncidents().find((i) => i.service === service);
      if (!inc) return { service, error: `No incident/deploy record for service "${service}".` };
      return { service, ...inc.deploy };
    },
  },
  {
    name: 'get_recent_incidents',
    description: 'List recent incidents for a service.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name' },
      },
      required: ['service'],
    },
    run({ service }) {
      const list = getIncidents()
        .filter((i) => i.service === service)
        .map((i) => ({ id: i.id, title: i.title, severity: i.severity, detectedAt: i.detectedAt }));
      return { service, count: list.length, incidents: list };
    },
  },
  {
    name: 'check_metric',
    description: 'Check a metric for a service against its baseline and return its status.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name' },
        metric: { type: 'string', description: 'Metric name: errorRate, p99Latency, memoryUsage, restarts' },
      },
      required: ['service', 'metric'],
    },
    run({ service, metric }) {
      const inc = getIncidents().find((i) => i.service === service);
      if (!inc) return { service, metric, error: `No incident record for service "${service}".` };
      const m = inc.metrics[metric];
      if (!m) return { service, metric, error: `Unknown metric "${metric}".` };
      return {
        service,
        metric,
        value: m.value,
        unit: m.unit,
        baseline: m.baseline,
        status: statusOf(m.value, m.baseline),
      };
    },
  },
  {
    name: 'propose_fix',
    description: 'Register a proposed remediation for an incident and return the guardrail decision for it.',
    inputSchema: {
      type: 'object',
      properties: {
        incident_id: { type: 'string', description: 'Incident id, e.g. INC-1001' },
        action: { type: 'string', description: 'Remediation action, e.g. rollback-deploy' },
        detail: { type: 'string', description: 'Human-readable description of the fix' },
      },
      required: ['incident_id', 'action', 'detail'],
    },
    run({ incident_id, action, detail }) {
      const guardrail = evaluate(action);
      return { incident_id, action, detail, guardrail };
    },
  },
];

function listTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/**
 * Call a tool by name with an arguments object.
 * @returns {{ok: boolean, result?: any, error?: string}}
 */
function callTool(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
  const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined);
  if (missing.length) {
    return { ok: false, error: `Tool "${name}" missing required argument(s): ${missing.join(', ')}.` };
  }
  try {
    return { ok: true, result: tool.run(args) };
  } catch (err) {
    return { ok: false, error: `Tool "${name}" failed: ${err.message}` };
  }
}

module.exports = { TOOLS, listTools, callTool, getIncidents, getLogs };
