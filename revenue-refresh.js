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
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync } = require('child_process');

const {
  loadWorkbook,
  extractSnapshot,
  validateSnapshot,
  diffSnapshot,
} = require('./revenue-refresh-core.js');

const SNAPSHOT_PATH = './revenue-workbook.json';
const DRIVE_REMOTE = 'ogqdrive:';
const DRIVE_FILE_ID = '1AWrYRCwFI0e9yz8vJzOnw-92Pjvx-G7O';
const TRUSTED_FILENAME = 'OGQ_매출현황_authoritative.xlsm';

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

function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function sameSnapshot(a, b) {
  const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  return a !== null && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

async function driveMain(argv, dependencies = {}) {
  const run = dependencies.execFileSync || execFileSync;
  const ask = dependencies.confirm || (async (question) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await prompt.question(question); } finally { prompt.close(); }
  });
  const tempRoot = (dependencies.mkdtempSync || fs.mkdtempSync)(path.join(os.tmpdir(), 'ogq-revenue-refresh-'));
  const workbookPath = path.join(tempRoot, TRUSTED_FILENAME);

  try {
    const redacted = run('rclone', ['config', 'redacted', DRIVE_REMOTE], { encoding: 'utf8' });
    if (!/^scope = drive\.readonly$/m.test(redacted)) {
      process.stderr.write('ERROR: ogqdrive scope is not drive.readonly.\n');
      return 2;
    }
    run('rclone', ['backend', 'copyid', DRIVE_REMOTE, DRIVE_FILE_ID, workbookPath], { stdio: 'inherit' });
    if (!fs.existsSync(workbookPath) || fs.statSync(workbookPath).size <= 0) {
      process.stderr.write('ERROR: Drive workbook fetch produced no readable content.\n');
      return 2;
    }

    const before = readSnapshot();
    const buffer = fs.readFileSync(workbookPath);
    const next = extractSnapshot(buffer, TRUSTED_FILENAME);
    const previewCode = main(['node', 'revenue-refresh.js', workbookPath]);
    process.stdout.write('attainment percent: ' + (next.cumulativeRevenue / next.annualTarget * 100) + '%\n');
    if (previewCode !== 0) return previewCode;
    if (sameSnapshot(before, next)) {
      process.stdout.write('변경 없음\n');
      return 0;
    }

    const answer = (await ask('변경을 revenue-workbook.json에 적용하려면 APPLY를 입력하세요: ')).trim();
    if (answer !== 'APPLY') {
      process.stdout.write('적용 취소. revenue-workbook.json은 변경되지 않았습니다.\n');
      return 0;
    }
    return main(['node', 'revenue-refresh.js', workbookPath, '--apply']);
  } finally {
    (dependencies.rmSync || fs.rmSync)(tempRoot, { recursive: true, force: true });
  }
}

async function operatorMain(argv) {
  const args = argv.slice(2);
  return args.length === 0 ? driveMain(argv) : main(argv);
}

if (require.main === module) {
  operatorMain(process.argv).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write('ERROR: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { main, driveMain, operatorMain, sameSnapshot };
