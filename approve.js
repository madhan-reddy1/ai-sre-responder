// approve.js — human-in-the-loop approval CLI.
//
// The responder never executes anything. A human reviews each verdict and
// explicitly approves or rejects the proposed fix. Approved fixes are written
// to reports/approved-plan.json — an execution plan, marked PLAN ONLY,
// NOT EXECUTED. Applying a plan to real infrastructure is a separate,
// human-owned step outside this tool.
//
// Usage:
//   node approve.js --list                 list verdicts + approval status
//   node approve.js --approve INC-1001     approve the proposed fix
//   node approve.js --reject INC-1001      reject the proposed fix
//   node approve.js --help

const fs = require('fs');
const path = require('path');
const { getIncidents } = require('./tools');

const REPORTS_DIR = path.join(__dirname, 'reports');
const STATE_FILE = path.join(REPORTS_DIR, 'approval-state.json');
const PLAN_FILE = path.join(REPORTS_DIR, 'approved-plan.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function verdictPath(id) {
  return path.join(REPORTS_DIR, `incident-${id}-verdict.md`);
}

function readVerdictFix(id) {
  try {
    const text = fs.readFileSync(verdictPath(id), 'utf8');
    const action = (text.match(/^- \*\*Action:\*\* `([^`]+)`/m) || [])[1] || null;
    const detail = (text.match(/^- \*\*Detail:\*\* (.+)$/m) || [])[1] || null;
    const risk = (text.match(/^- \*\*Risk:\*\* (\w+)/m) || [])[1] || null;
    return action ? { action, detail, risk } : null;
  } catch {
    return null;
  }
}

function list() {
  const state = loadState();
  const rows = getIncidents().map((inc) => {
    const hasVerdict = fs.existsSync(verdictPath(inc.id));
    const fix = hasVerdict ? readVerdictFix(inc.id) : null;
    return {
      id: inc.id,
      title: inc.title,
      verdict: hasVerdict ? 'yes' : 'no — run node respond.js ' + inc.id,
      fix: fix ? `${fix.action} (${fix.risk} risk)` : 'none',
      status: state[inc.id] || 'awaiting-approval',
    };
  });
  console.log('\nIncident verdicts:');
  console.log('ID        Status              Fix');
  console.log('--------  ------------------  ----------------------------------');
  rows.forEach((r) => {
    console.log(`${r.id.padEnd(10)}${r.status.padEnd(20)}${r.fix}`);
    console.log(`          ${r.title} — verdict: ${r.verdict}`);
  });
  console.log('');
}

function setStatus(id, status) {
  const known = getIncidents().map((i) => i.id);
  if (!known.includes(id)) {
    console.error(`Error: unknown incident "${id}". Known: ${known.join(', ')}.`);
    process.exit(1);
  }
  if (!fs.existsSync(verdictPath(id))) {
    console.error(`Error: no verdict yet for ${id}. Run: node respond.js ${id}`);
    process.exit(1);
  }
  const fix = readVerdictFix(id);
  const state = loadState();
  state[id] = status;
  saveState(state);

  // Rebuild the execution plan from all approved fixes.
  const plan = { note: 'PLAN ONLY — NOT EXECUTED. Applying this plan to real infrastructure is a human-owned step.', actions: [] };
  for (const [incId, st] of Object.entries(state)) {
    if (st === 'approved') {
      const f = readVerdictFix(incId);
      if (f) plan.actions.push({ incident: incId, ...f });
    }
  }
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));
  console.log(`${status === 'approved' ? '✅ Approved' : '❌ Rejected'}: ${id}${fix ? ` — ${fix.action} (${fix.risk} risk)` : ''}`);
  console.log(`Approval state: ${STATE_FILE}`);
  console.log(`Execution plan: ${PLAN_FILE} (${plan.actions.length} approved action(s), PLAN ONLY — NOT EXECUTED)`);
}

function printHelp() {
  console.log('Usage:');
  console.log('  node approve.js --list              list verdicts + approval status');
  console.log('  node approve.js --approve INC-1001  approve the proposed fix');
  console.log('  node approve.js --reject INC-1001   reject the proposed fix');
}

if (require.main === module) {
  const [flag, id] = process.argv.slice(2);
  if (flag === '--help' || flag === '-h' || !flag) {
    printHelp();
    process.exit(flag ? 0 : 1);
  }
  if (flag === '--list') {
    list();
    process.exit(0);
  }
  if (flag === '--approve' || flag === '--reject') {
    if (!id) {
      console.error(`Error: ${flag} needs an incident id, e.g. ${flag} INC-1001`);
      process.exit(1);
    }
    setStatus(id, flag === '--approve' ? 'approved' : 'rejected');
    process.exit(0);
  }
  console.error(`Error: unknown flag "${flag}".`);
  printHelp();
  process.exit(1);
}

module.exports = { loadState, setStatus };
