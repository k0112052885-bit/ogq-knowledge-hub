'use strict';

/**
 * revenue-refresh.js - repeatable 50억 revenue-refresh CLI (repo root).
 *
 * Usage:
 *   node revenue-refresh.js <path-to-xlsm> [--apply]
 *
 * Reads an OGQ 매출현황 workbook READ-ONLY and regenerates the existing
 * ./revenue-workbook.json snapshot. Without --apply it only previews.
 * Never writes the source workbook. Never runs git.
 */

const fs = require('fs');
const path = require('path');

const {
  loadWorkbook,
  extractSnapshot,
  validateSnapshot,
  diffSnapshot,
} = require('./revenue-refresh-core.js');

const SNAPSHOT_PATH = './revenue-workbook.json';

function fmt(v) {
  if (v === null || v === undefined) return 'n/a';
  return String(v);
}

function main(argv) {
  const args = argv.slice(2);
  const apply = args.includes('--apply');
  const xlsmArg = args.find((a) => !a.startsWith('--'));

  if (!xlsmArg) {
    process.stderr.write(
      'ERROR: missing workbook path.\n' +
        'Usage: node revenue-refresh.js <path-to-xlsm> [--apply]\n'
    );
    return 2;
  }

  const xlsmPath = path.resolve(xlsmArg);
  if (!fs.existsSync(xlsmPath)) {
    process.stderr.write('ERROR: workbook not found: ' + xlsmPath + '\n');
    return 2;
  }

  const buf = fs.readFileSync(xlsmPath); // READ-ONLY
  const filename = path.basename(xlsmPath);

  const wb = loadWorkbook(buf);
  const snapshot = extractSnapshot(buf, filename);
  const validation = validateSnapshot(snapshot, wb, filename);

  let prev = null;
  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      prev = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch (_) {
      prev = null;
    }
  }

  const diff = diffSnapshot(prev, snapshot, xlsmPath);
  const identity = validation.gates.find((g) => g.name === 'WORKBOOK_IDENTITY');

  const out = [];
  out.push('workbook path: ' + xlsmPath);
  out.push('identity: ' + (identity && identity.ok ? 'PASS' : 'FAIL'));
  out.push(
    'cumulative revenue: ' +
      fmt(diff.prevCumulative) +
      ' -> ' +
      fmt(diff.nextCumulative) +
      ' (delta ' +
      fmt(diff.cumulativeDelta) +
      ')'
  );
  out.push('weekly revenue: ' + fmt(diff.prevWeekly) + ' -> ' + fmt(diff.nextWeekly));
  out.push('report week: ' + fmt(diff.prevReportWeek) + ' -> ' + fmt(diff.nextReportWeek));
  out.push('week start / end: ' + fmt(diff.weekStart) + ' ~ ' + fmt(diff.weekEnd));
  out.push('annual target: ' + fmt(diff.target));
  out.push('cross-check diff: ' + fmt(diff.crosscheckDiff) + ' KRW');
  for (const g of validation.gates) {
    out.push('- ' + g.name + ': ' + (g.ok ? 'PASS' : 'FAIL') + ' (' + g.detail + ')');
  }
  out.push('VALIDATION: ' + (validation.ok ? 'PASS' : 'FAIL'));
  process.stdout.write(out.join('\n') + '\n');

  if (!validation.ok) {
    const failed = validation.gates.filter((g) => !g.ok);
    process.stdout.write(
      'gate failures: ' + failed.map((g) => g.name + ' (' + g.detail + ')').join('; ') + '\n'
    );
    process.stdout.write('revenue-workbook.json was NOT modified.\n');
    return 1;
  }

  if (!apply) {
    process.stdout.write(
      'Preview only. Re-run with --apply to write revenue-workbook.json.\n'
    );
    return 0;
  }

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  process.stdout.write('revenue-workbook.json updated.\n');
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main };
