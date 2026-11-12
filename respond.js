// respond.js — run the full agent pipeline for an incident and write a verdict report.
//
// Usage:
//   node respond.js INC-1001        run one incident
//   node respond.js --all           run all sample incidents
//   node respond.js --help
//
// Output: reports/incident-<id>-verdict.md — agent trace, root cause,
// proposed fix, guardrail decision, and approval status.

const fs = require('fs');
const path = require('path');
const { orchestrate } = require('./agents');
const { getIncidents } = require('./tools');

const REPORTS_DIR = path.join(__dirname, 'reports');

function fmtStep(n, s) {
  const lines = [`### Step ${n} — ${s.agent}`];
  if (s.thought) lines.push(`**Thought:** ${s.thought}`);
  if (s.action) lines.push(`**Action:** \`${s.action}\``);
  if (s.observation) lines.push(`**Observation:** ${s.observation}`);
  return lines.join('\n');
}

function renderVerdict(v) {
  const { incident, diagnosis, proposedFix, guardrail, blockedCandidates, trace } = v;
  const lines = [];
  lines.push(`# Incident verdict: ${incident.id} — ${incident.title}`);
  lines.push('');
  lines.push(`**Service:** ${incident.service} · **Severity:** ${incident.severity} · **Detected:** ${incident.detectedAt}`);
  lines.push('');
  lines.push('> ⚠️ **Sample / demo data.** This verdict was produced from the bundled sample incidents and logs. It is not a real production incident.');
  lines.push('');
  lines.push('## Agent trace');
  lines.push('');
  trace.forEach((s, i) => lines.push(fmtStep(i + 1, s), ''));
  lines.push('## Root cause');
  lines.push('');
  lines.push(`**Confidence:** ${diagnosis.confidence}`);
  lines.push('');
  lines.push(diagnosis.rootCause);
  if (diagnosis.evidence.length) {
    lines.push('');
    lines.push('Supporting evidence:');
    diagnosis.evidence.forEach((e) => lines.push(`- ${e}`));
  }
  lines.push('');
  lines.push('## Proposed fix');
  lines.push('');
  if (proposedFix) {
    lines.push(`- **Action:** \`${proposedFix.action}\``);
    lines.push(`- **Detail:** ${proposedFix.detail}`);
    lines.push(`- **Risk:** ${guardrail.risk}`);
    lines.push(`- **Guardrail:** ${guardrail.decision} — ${guardrail.reason}`);
  } else {
    lines.push('No fix proposed. The incident needs a human.');
  }
  if (blockedCandidates.length) {
    lines.push('');
    lines.push('### Blocked candidates (guardrail)');
    lines.push('');
    blockedCandidates.forEach((b) => {
      lines.push(`- \`${b.action}\` — ${b.detail} **Blocked:** ${b.guardrail.reason}`);
    });
  }
  lines.push('');
  lines.push('## Approval status');
  lines.push('');
  lines.push(`**${v.status === 'awaiting-approval' ? 'Awaiting human approval' : 'Needs a human — no fix proposed'}** — use \`node approve.js\` to approve or reject. Nothing has been executed.`);
  lines.push('');
  return lines.join('\n');
}

function runOne(incidentId) {
  const verdict = orchestrate(incidentId);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, `incident-${incidentId}-verdict.md`);
  fs.writeFileSync(outPath, renderVerdict(verdict));
  console.log(`\n🤖 ${incidentId} — ${verdict.incident.title}`);
  console.log(`   Root cause (${verdict.diagnosis.confidence} confidence): ${verdict.diagnosis.rootCause}`);
  if (verdict.proposedFix) {
    console.log(`   Proposed fix: ${verdict.proposedFix.action} — ${verdict.proposedFix.detail}`);
    console.log(`   Guardrail: ${verdict.guardrail.decision} (${verdict.guardrail.risk} risk)`);
  } else {
    console.log('   Proposed fix: none — needs a human.');
  }
  if (verdict.blockedCandidates.length) {
    verdict.blockedCandidates.forEach((b) => {
      console.log(`   Blocked by guardrail: ${b.action} (${b.guardrail.risk} risk)`);
    });
  }
  console.log(`   Verdict written to: ${outPath}`);
  return verdict;
}

function printHelp() {
  console.log('Usage:');
  console.log('  node respond.js INC-1001   run the responder for one incident');
  console.log('  node respond.js --all      run it for all sample incidents');
  console.log('Known incidents:', getIncidents().map((i) => i.id).join(', '));
}

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(arg ? 0 : 1);
  }
  if (arg === '--all') {
    const ids = getIncidents().map((i) => i.id);
    const results = ids.map((id) => runOne(id));
    const withFix = results.filter((r) => r.proposedFix).length;
    console.log(`\nDone: ${results.length} incidents, ${withFix} with a guardrailed fix, ${results.length - withFix} needing a human.`);
    process.exit(0);
  }
  try {
    runOne(arg);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    printHelp();
    process.exit(1);
  }
}

module.exports = { runOne, renderVerdict };
