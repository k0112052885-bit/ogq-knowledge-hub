'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadWorkbook, excelSerialToISO } = require('./revenue-refresh-core.js');
const { businessWeek } = require('./server/handlers/revenue-summary.js');

const DRIVE_REMOTE = 'ogqdrive:';
const DRIVE_FILE_ID = '1K1TKpANHXiknb7hzd1kDUxHCdMKUZDvz';
const TRUSTED_FILENAME = 'OGQ_마켓본부_주간보고_2026.xlsx';
const SHEET_NAME = '2026 주간보고';
const SNAPSHOT_PATH = './weekly-actions.json';
const EXPECTED_TEAMS = ['Sales & Gov', '운영', '개발', '신규 서비스', 'IP커머스/사업화'];

function columnName(number) {
  let value = number;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function section(text, name) {
  const source = String(text || '').replace(/\r/g, '');
  const marker = new RegExp(`^\\s*■\\s*${name}\\s*$`, 'm');
  const match = marker.exec(source);
  if (!match) return null;
  const rest = source.slice(match.index + match[0].length);
  const next = /^\s*■\s*(?:진행|완료|예정|이슈)\s*$/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function sourceEntries(text) {
  if (!text) return [];
  const entries = [];
  let context = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-·└]\s*(.+)$/.exec(line);
    if (!bullet) {
      context = line.replace(/:$/, '').trim();
      continue;
    }
    const value = bullet[1].trim();
    if (!value || /^(?:차주 예정 업무|문의\s*\/\s*협업 요청 등)/.test(value)) continue;
    entries.push(context && !value.startsWith(context) ? `${context} · ${value}` : value);
  }
  return entries;
}

function weekColumns(sheet, anchor) {
  if (sheet.B1 !== '팀') throw new Error('WEEKLY_SCHEMA: expected B1 팀');
  const teams = EXPECTED_TEAMS.map((team, index) => {
    const row = index + 4;
    if (sheet[`B${row}`] !== team) throw new Error(`WEEKLY_SCHEMA: expected ${team} at B${row}`);
    return { team, row };
  });
  const weeks = [];
  for (let index = 3; index <= 27; index += 1) {
    const column = columnName(index);
    const header = String(sheet[`${column}1`] || '');
    if (!header) continue;
    const label = /^(\d+)주차/.exec(header);
    if (!label) throw new Error(`WEEKLY_SCHEMA: malformed week label at ${column}1`);
    const startValue = Number(sheet[`${column}2`]);
    const endValue = Number(sheet[`${column}3`]);
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) throw new Error(`WEEKLY_DATE: invalid date at ${column}`);
    const startDate = excelSerialToISO(startValue);
    const endDate = excelSerialToISO(endValue);
    if (!startDate || !endDate) throw new Error(`WEEKLY_DATE: invalid date at ${column}`);
    const derivedWeek = businessWeek(new Date(`${endDate}T00:00:00Z`), anchor);
    const sourceWeek = Number(label[1]);
    if (sourceWeek !== derivedWeek) throw new Error(`WEEKLY_WEEK_MISMATCH: ${sourceWeek} != ${derivedWeek} at ${column}`);
    const reports = teams.map(({ team, row }) => {
      const value = sheet[`${column}${row}`];
      if (value === undefined || value === null) throw new Error(`WEEKLY_SCHEMA: missing ${column}${row}`);
      const progress = section(value, '진행');
      const completed = section(value, '완료');
      if (progress === null) throw new Error(`WEEKLY_SCHEMA: missing 진행 at ${column}${row}`);
      if (completed === null) throw new Error(`WEEKLY_SCHEMA: missing 완료 at ${column}${row}`);
      return { team, progress: sourceEntries(progress), completed: sourceEntries(completed) };
    });
    weeks.push({ sourceWeek, businessWeek: derivedWeek, startDate, endDate, reports });
  }
  return weeks;
}

function hasContent(week) {
  return week.reports.some((report) => report.progress.length || report.completed.length);
}

function normalizeWeeklyActions(workbook, now, anchor) {
  const names = Object.keys(workbook.sheets || {});
  if (names.length !== 1 || names[0] !== SHEET_NAME) throw new Error(`WEEKLY_SCHEMA: expected only ${SHEET_NAME}`);
  const weeks = weekColumns(workbook.sheets[SHEET_NAME], anchor);
  const operatingWeek = businessWeek(now, anchor);
  const substantive = weeks.filter(hasContent);
  const current = substantive.find((week) => week.businessWeek === operatingWeek);
  if (!current) return { operatingWeek, selectedCurrentWeek: null, selectedPreviousWeek: null, records: [] };
  const previous = substantive.filter((week) => week.businessWeek < current.businessWeek).at(-1) || null;
  if (!previous) throw new Error('WEEKLY_PREVIOUS: previous substantive week is missing');
  const records = substantive.map((week, index) => {
    const prior = substantive[index - 1] || null;
    return {
      week: week.businessWeek,
      sourceWeek: week.sourceWeek,
      sourceStartDate: week.startDate,
      sourceEndDate: week.endDate,
      currentActions: week.reports.flatMap((report) => report.progress.map((title) => ({ title: `${report.team} · ${title}`, status: '진행중' }))),
      previousActionEffects: prior
        ? prior.reports.flatMap((report) => report.completed.map((effectSummary) => ({ actionTitle: report.team, effectSummary })))
        : [],
    };
  });
  return {
    operatingWeek,
    selectedCurrentWeek: current.businessWeek,
    selectedPreviousWeek: previous.businessWeek,
    records,
  };
}

function printPreview(result) {
  process.stdout.write(`weekly actions: ${result.selectedCurrentWeek === null ? '변경 가능한 현재 주차 없음' : `${result.selectedCurrentWeek}주차`}\n`);
  if (result.selectedPreviousWeek !== null) process.stdout.write(`previous effects: ${result.selectedPreviousWeek}주차\n`);
  const current = result.records.find((record) => record.week === result.selectedCurrentWeek);
  for (const action of current?.currentActions || []) process.stdout.write(`- [이번 주] ${action.title}\n`);
  for (const effect of current?.previousActionEffects || []) process.stdout.write(`- [지난 주] ${effect.actionTitle} · ${effect.effectSummary}\n`);
  process.stdout.write('VALIDATION: PASS\n');
}

function refresh(dependencies = {}) {
  const run = dependencies.execFileSync || execFileSync;
  const makeTemp = dependencies.mkdtempSync || fs.mkdtempSync;
  const remove = dependencies.rmSync || fs.rmSync;
  const now = dependencies.now || new Date();
  const anchor = dependencies.anchor || JSON.parse(fs.readFileSync('./revenue-workbook.json', 'utf8')).weekAnchor;
  const tempRoot = makeTemp(path.join(os.tmpdir(), 'ogq-weekly-actions-'));
  const workbookPath = path.join(tempRoot, TRUSTED_FILENAME);
  try {
    const redacted = run('rclone', ['config', 'redacted', DRIVE_REMOTE], { encoding: 'utf8' });
    if (!/^scope = drive\.readonly$/m.test(redacted)) throw new Error('DRIVE_SCOPE: ogqdrive must be drive.readonly');
    run('rclone', ['backend', 'copyid', DRIVE_REMOTE, DRIVE_FILE_ID, workbookPath], { stdio: 'inherit' });
    const workbook = loadWorkbook(fs.readFileSync(workbookPath));
    const result = normalizeWeeklyActions(workbook, now, anchor);
    printPreview(result);
    if (result.selectedCurrentWeek === null) {
      process.stdout.write('변경 없음: weekly-actions.json was not modified.\n');
      return result;
    }
    const tempSnapshot = `${SNAPSHOT_PATH}.tmp`;
    fs.writeFileSync(tempSnapshot, JSON.stringify(result.records, null, 2) + '\n');
    fs.renameSync(tempSnapshot, SNAPSHOT_PATH);
    process.stdout.write('weekly-actions.json updated.\n');
    return result;
  } finally {
    remove(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { refresh(); }
  catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { section, sourceEntries, weekColumns, normalizeWeeklyActions, refresh };
