'use strict';

/**
 * revenue-refresh-core.js
 *
 * Pure, zero-dependency helpers for regenerating the revenue-workbook.json
 * snapshot from an OGQ 매출현황 .xlsm/.xlsx workbook.
 *
 * Node built-ins only: zlib (fs / path are used only by the CLI wrapper).
 * No network. No file writes. No VBA execution (xl/vbaProject.bin is ignored).
 */

const zlib = require('zlib');

// ---------------------------------------------------------------------------
// ZIP container parsing (central directory is authoritative)
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50;
const SIG_CDH = 0x02014b50;
const SIG_LFH = 0x04034b50;

/**
 * unzipXlsx(buffer) -> { entryName: Buffer }
 *
 * Parses the ZIP CENTRAL DIRECTORY as the single source of truth. This is
 * required for real Google-exported .xlsm files whose entries are streamed
 * (General Purpose Bit Flag bit 3 / 0x08 set): the local file header then
 * carries compressedSize == 0 and uncompressedSize == 0, and the true sizes
 * live only in a trailing data descriptor. We never read the data descriptor;
 * we slice exactly `compressedSize` bytes (from the central directory) after
 * the local header.
 */
function unzipXlsx(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  // (1) Locate End Of Central Directory. Scan backwards from the end within
  // the last 22 + 65535 bytes (comment max). No ZIP64 here.
  const minEocd = 22;
  const maxScan = Math.min(buffer.length, minEocd + 0xffff);
  let eocd = -1;
  for (let i = buffer.length - minEocd; i >= buffer.length - maxScan && i >= 0; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('ZIP_EOCD_NOT_FOUND');
  }

  const totalRecords = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);

  const entries = {};
  let p = cdOffset;
  for (let n = 0; n < totalRecords; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== SIG_CDH) {
      throw new Error('ZIP_BAD_CENTRAL_DIRECTORY_SIGNATURE@' + p);
    }
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) {
      continue; // directory entry
    }

    // (3) Seek to the local file header; sizes are taken from the central
    // directory, not from the (possibly zeroed) local header.
    const localOff = localHeaderOffset;
    if (localOff + 30 > buffer.length || buffer.readUInt32LE(localOff) !== SIG_LFH) {
      throw new Error('ZIP_BAD_LOCAL_HEADER_SIGNATURE:' + name);
    }
    const localNameLen = buffer.readUInt16LE(localOff + 26);
    const localExtraLen = buffer.readUInt16LE(localOff + 28);
    const payloadStart = localOff + 30 + localNameLen + localExtraLen;
    const slice = buffer.subarray(payloadStart, payloadStart + compressedSize);

    let data;
    if (method === 0) {
      data = Buffer.from(slice);
      if (uncompressedSize && data.length !== uncompressedSize) {
        // stored size mismatch is not fatal, but keep the authoritative length
        data = Buffer.from(slice.subarray(0, uncompressedSize));
      }
    } else if (method === 8) {
      data = zlib.inflateRawSync(slice);
    } else {
      throw new Error('UNSUPPORTED_ZIP_METHOD:' + method);
    }

    entries[name] = data;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/**
 * xmlDecode(s) - decode the 5 predefined entities plus numeric character
 * references (&#NN; / &#xHH;).
 */
function xmlDecode(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * parseSharedStrings(xml) -> string[]
 *
 * Only matches <si> ... </si> pairs. A self-closing <si/> therefore yields
 * NO entry. Inside each <si>, concatenate every <t ...> ... </t>; with no
 * <t> the string is ''.
 */
function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(inner)) !== null) {
      text += xmlDecode(tm[1]);
    }
    out.push(text);
  }
  return out;
}

/**
 * parseSheet(xml, sharedStrings) -> flat map { 'A1': value, ... }
 */
function parseSheet(xml, sharedStrings) {
  const cells = {};
  if (!xml) return cells;
  sharedStrings = sharedStrings || [];

  const cRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cRe.exec(xml)) !== null) {
    const attrs = m[1] || '';
    const selfClosing = m[2] === '/>';
    const body = selfClosing ? '' : (m[3] || '');

    const rMatch = /\br="([^"]+)"/.exec(attrs);
    if (!rMatch) continue;
    const ref = rMatch[1];

    const tMatch = /\bt="([^"]+)"/.exec(attrs);
    const type = tMatch ? tMatch[1] : null;

    let value;
    if (type === 'inlineStr' || /<is>/.test(body)) {
      let text = '';
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(body)) !== null) {
        text += xmlDecode(tm[1]);
      }
      value = text;
    } else {
      const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      if (!vMatch) {
        if (selfClosing) continue;
        // <c> with no <v> - skip unless it was an inline string (handled above)
        continue;
      }
      const raw = xmlDecode(vMatch[1]);
      if (type === 's') {
        value = sharedStrings[Number(raw)];
        if (value === undefined) value = '';
      } else {
        value = raw; // numbers kept as their string form
      }
    }

    cells[ref] = value;
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Workbook loading
// ---------------------------------------------------------------------------

function loadWorkbook(buffer) {
  const entries = unzipXlsx(buffer);

  const workbookXml = bufToStr(entries['xl/workbook.xml']);
  const relsXml = bufToStr(entries['xl/_rels/workbook.xml.rels']);
  const sharedStrings = parseSharedStrings(bufToStr(entries['xl/sharedStrings.xml']));

  // name -> r:id
  const nameToRid = {};
  if (workbookXml) {
    const sheetRe = /<sheet\b([^>]*)\/?>/g;
    let m;
    while ((m = sheetRe.exec(workbookXml)) !== null) {
      const a = m[1];
      const name = attr(a, 'name');
      const rid = attr(a, 'r:id') || attr(a, 'id');
      if (name && rid) nameToRid[name] = rid;
    }
  }

  // r:id -> target
  const ridToTarget = {};
  if (relsXml) {
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    let m;
    while ((m = relRe.exec(relsXml)) !== null) {
      const a = m[1];
      const id = attr(a, 'Id');
      let target = attr(a, 'Target');
      if (id && target) {
        target = target.replace(/^\/xl\//, '').replace(/^\//, '');
        if (!target.startsWith('xl/') && !target.startsWith('worksheets/')) {
          // relative to xl/
        }
        ridToTarget[id] = target;
      }
    }
  }

  const sheets = {};
  const sheetNames = Object.keys(nameToRid);
  for (const name of sheetNames) {
    const rid = nameToRid[name];
    let target = ridToTarget[rid];
    if (!target) continue;
    // Normalise to an entry key inside the zip.
    let key = target;
    if (!key.startsWith('xl/')) {
      key = 'xl/' + key.replace(/^xl\//, '');
    }
    let xml = bufToStr(entries[key]);
    if (xml === '' && entries['xl/' + target] !== undefined) {
      xml = bufToStr(entries['xl/' + target]);
    }
    sheets[name] = parseSheet(xml, sharedStrings);
  }

  return { sheets, sheetNames };
}

function bufToStr(buf) {
  if (buf === undefined || buf === null) return '';
  return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
}

function attr(attrString, name) {
  const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]*)"');
  const m = re.exec(attrString);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Cell-address helpers
// ---------------------------------------------------------------------------

function splitRef(ref) {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!m) return null;
  return { col: m[1], row: parseInt(m[2], 10) };
}

function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function numToCol(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rowsOf(cells) {
  const rows = {};
  for (const ref of Object.keys(cells)) {
    const s = splitRef(ref);
    if (!s) continue;
    (rows[s.row] || (rows[s.row] = {}))[s.col] = cells[ref];
  }
  return rows;
}

// ---------------------------------------------------------------------------
// sumCumulative
// ---------------------------------------------------------------------------

function sumCumulative(rawCells) {
  rawCells = rawCells || {};
  const rows = rowsOf(rawCells);
  const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);

  let headerRow = -1;
  let amountCol = null;
  let includeCol = null;

  for (const rn of rowNums) {
    const row = rows[rn];
    let aCol = null;
    let iCol = null;
    for (const col of Object.keys(row)) {
      const v = row[col];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t === '매출 금액') aCol = col;
      else if (t === '누적 집계 포함') iCol = col;
    }
    if (aCol && iCol) {
      headerRow = rn;
      amountCol = aCol;
      includeCol = iCol;
      break;
    }
  }

  if (headerRow < 0) {
    throw new Error('EMPTY_CUMULATIVE');
  }

  let sum = 0;
  let qualifying = 0;
  for (const rn of rowNums) {
    if (rn <= headerRow) continue;
    const row = rows[rn];
    const inc = parseFloat(row[includeCol]);
    const amt = parseFloat(row[amountCol]);
    if (inc === 1 && Number.isFinite(amt)) {
      sum += amt;
      qualifying++;
    }
  }

  if (qualifying === 0) {
    throw new Error('EMPTY_CUMULATIVE');
  }

  return sum;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function excelSerialToISO(serial) {
  return new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000)
    .toISOString()
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Label lookup
// ---------------------------------------------------------------------------

/**
 * valueForLabel(sheetCells, labelText, valueCol)
 *
 * Locates the row whose cells contain labelText, and returns the value from
 * the adjacent value column. If valueCol is omitted, the first non-empty
 * cell to the right of the label cell on the same row is used.
 */
function valueForLabel(sheetCells, labelText, valueCol) {
  const rows = rowsOf(sheetCells || {});
  const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
  for (const rn of rowNums) {
    const row = rows[rn];
    let labelCol = null;
    for (const col of Object.keys(row)) {
      const v = row[col];
      if (typeof v === 'string' && v.trim() === labelText) {
        labelCol = col;
        break;
      }
    }
    if (labelCol == null) continue;

    if (valueCol) {
      const v = row[valueCol];
      if (v !== undefined) return v;
    }
    // fall back: first populated cell to the right
    const labelNum = colToNum(labelCol);
    const rightCols = Object.keys(row)
      .filter((c) => colToNum(c) > labelNum)
      .sort((a, b) => colToNum(a) - colToNum(b));
    if (rightCols.length) return row[rightCols[0]];
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Snapshot extraction
// ---------------------------------------------------------------------------

function parseWeekRangeCell(text) {
  if (typeof text !== 'string') return null;
  const m = /(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

function calendarRowForWeek(calCells, reportWeek) {
  const rows = rowsOf(calCells || {});
  const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);

  // Find header row containing '주차' and '주간 기간' (or start/end labels).
  let headerRow = -1;
  let weekCol = null;
  let rangeCol = null;
  let startCol = null;
  let endCol = null;
  for (const rn of rowNums) {
    const row = rows[rn];
    let wCol = null;
    let rCol = null;
    let sCol = null;
    let eCol = null;
    for (const col of Object.keys(row)) {
      const v = row[col];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t === '주차') wCol = col;
      else if (t === '주간 기간') rCol = col;
      else if (t === '시작일' || t === '주간 시작일') sCol = col;
      else if (t === '종료일' || t === '주간 종료일') eCol = col;
    }
    if (wCol && (rCol || (sCol && eCol))) {
      headerRow = rn;
      weekCol = wCol;
      rangeCol = rCol;
      startCol = sCol;
      endCol = eCol;
      break;
    }
  }

  if (headerRow < 0) return null;

  for (const rn of rowNums) {
    if (rn <= headerRow) continue;
    const row = rows[rn];
    const wk = parseInt(row[weekCol], 10);
    if (wk !== reportWeek) continue;

    if (rangeCol) {
      const parsed = parseWeekRangeCell(row[rangeCol]);
      if (parsed) return parsed;
    }
    if (startCol && endCol && row[startCol] !== undefined && row[endCol] !== undefined) {
      return {
        start: excelSerialToISO(row[startCol]),
        end: excelSerialToISO(row[endCol]),
      };
    }
    // Last resort: scan the row for any range-shaped cell.
    for (const col of Object.keys(row)) {
      const parsed = parseWeekRangeCell(row[col]);
      if (parsed) return parsed;
    }
    return null;
  }
  return null;
}

/**
 * extractSnapshot(buffer, filename) -> the existing 8-field
 * revenue-workbook.json contract, at full numeric precision.
 *
 * MUST NOT call businessWeek - weekAnchor is built purely from 06_Settings.
 */
function extractSnapshot(buffer, filename) {
  const wb = loadWorkbook(buffer);
  const S = wb.sheets;

  const raw = S['02_Raw_Data'] || {};
  const summary = S['03_Summary'] || {};
  const calendar = S['04_Calendar'] || {};
  const settings = S['06_Settings'] || {};

  const cumulativeRevenue = sumCumulative(raw);

  const cumulativeRevenueVerification = toNum(
    valueForLabel(summary, '연간 누적 매출', 'C')
  );
  const weeklyRevenue = toNum(valueForLabel(summary, '이번 주 매출', 'C'));
  const annualTarget = toNum(valueForLabel(settings, '연간 목표 매출', 'B'));
  const reportWeek = parseInt(valueForLabel(settings, '리포트 기준 주차', 'B'), 10);

  const anchorWeek = parseInt(valueForLabel(settings, '앵커 주차', 'B'), 10);
  const anchorStartSerial = valueForLabel(settings, '앵커 시작일', 'B');
  const anchorStartDate = excelSerialToISO(anchorStartSerial);

  const range = calendarRowForWeek(calendar, reportWeek) || { start: null, end: null };

  return {
    cumulativeRevenue,
    cumulativeRevenueVerification,
    weeklyRevenue,
    annualTarget,
    reportWeek,
    weekAnchor: {
      anchorWeek,
      anchorStartDate,
    },
    weekStart: range.start,
    weekEnd: range.end,
  };
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return NaN;
  return parseFloat(v);
}

function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function utcWeekday(iso) {
  return new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
}

const FRIDAY = 5;
const THURSDAY = 4;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSnapshot(snapshot, workbook, filename, options) {
  options = options || {};
  const { businessWeek } = require('./server/handlers/revenue-summary.js');
  const sheets = (workbook && workbook.sheets) || {};
  const gates = [];

  // --- WORKBOOK_IDENTITY ---
  const nameOk = /ogq/i.test(filename) && /매출현황/.test(filename) && /\.xlsm$/i.test(filename);
  const required = ['02_Raw_Data', '03_Summary', '04_Calendar', '06_Settings'];
  const missing = required.filter((s) => !sheets[s]);
  gates.push({
    name: 'WORKBOOK_IDENTITY',
    ok: nameOk && missing.length === 0,
    detail: nameOk
      ? missing.length === 0
        ? 'filename + all sheets present'
        : 'missing sheets: ' + missing.join(', ')
      : 'filename does not match OGQ 매출현황 *.xlsm',
  });

  // --- SCHEMA ---
  let schemaOk = true;
  const schemaProblems = [];
  const rawHeader = findHeaderTexts(sheets['02_Raw_Data']);
  if (!rawHeader.has('매출 금액') || !rawHeader.has('누적 집계 포함')) {
    schemaOk = false;
    schemaProblems.push('02_Raw_Data header missing 매출 금액/누적 집계 포함');
  }
  const settingsLabels = allLabelTexts(sheets['06_Settings']);
  for (const lbl of ['앵커 주차', '앵커 시작일', '연간 목표 매출']) {
    if (!settingsLabels.has(lbl)) {
      schemaOk = false;
      schemaProblems.push('06_Settings missing ' + lbl);
    }
  }
  gates.push({
    name: 'SCHEMA',
    ok: schemaOk,
    detail: schemaOk ? 'required columns/labels present' : schemaProblems.join('; '),
  });

  // --- CUMULATIVE_CROSSCHECK ---
  const crossDiff = Math.abs(
    snapshot.cumulativeRevenue - snapshot.cumulativeRevenueVerification
  );
  gates.push({
    name: 'CUMULATIVE_CROSSCHECK',
    ok: crossDiff < 1,
    detail: 'abs diff = ' + crossDiff + ' KRW',
  });

  // --- BUSINESS_WEEK ---
  let bwOk = true;
  const bwProblems = [];
  const wsWeekday = isISODate(snapshot.weekStart) ? utcWeekday(snapshot.weekStart) : null;
  const weWeekday = isISODate(snapshot.weekEnd) ? utcWeekday(snapshot.weekEnd) : null;
  if (wsWeekday !== FRIDAY) {
    bwOk = false;
    bwProblems.push('weekStart not Friday');
  }
  if (weWeekday !== THURSDAY) {
    bwOk = false;
    bwProblems.push('weekEnd not Thursday');
  }
  const anchorStart = snapshot.weekAnchor && snapshot.weekAnchor.anchorStartDate;
  if (!isISODate(anchorStart) || utcWeekday(anchorStart) !== FRIDAY) {
    bwOk = false;
    bwProblems.push('anchorStartDate not Friday');
  }
  if (isISODate(snapshot.weekStart)) {
    try {
      const parts = snapshot.weekStart.split('-').map(Number);
      const computed = businessWeek(
        new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])),
        snapshot.weekAnchor
      );
      if (computed !== snapshot.reportWeek) {
        bwOk = false;
        bwProblems.push(
          'businessWeek(weekStart)=' + computed + ' != reportWeek ' + snapshot.reportWeek
        );
      }
    } catch (e) {
      bwOk = false;
      bwProblems.push('businessWeek threw: ' + e.message);
    }
  } else {
    bwOk = false;
    bwProblems.push('weekStart invalid');
  }
  gates.push({
    name: 'BUSINESS_WEEK',
    ok: bwOk,
    detail: bwOk ? 'Fri->Thu; businessWeek matches reportWeek' : bwProblems.join('; '),
  });

  // --- EXTRACTION ---
  const extractionOk =
    Number.isFinite(snapshot.cumulativeRevenue) &&
    Number.isFinite(snapshot.weeklyRevenue) &&
    Number.isFinite(snapshot.annualTarget) &&
    Number.isFinite(snapshot.reportWeek) &&
    isISODate(snapshot.weekStart) &&
    isISODate(snapshot.weekEnd);
  gates.push({
    name: 'EXTRACTION',
    ok: extractionOk,
    detail: extractionOk
      ? 'all numeric fields finite; ISO dates valid'
      : 'one or more extracted fields invalid',
  });

  // --- READ_ONLY (informational) ---
  const readOnlyOk = !options.sourceWritten;
  gates.push({
    name: 'READ_ONLY',
    ok: readOnlyOk,
    detail: readOnlyOk ? 'source workbook opened read-only' : 'source workbook was written',
  });

  const ok = gates.every((g) => g.ok);
  return { ok, gates };
}

function findHeaderTexts(cells) {
  const set = new Set();
  if (!cells) return set;
  const rows = rowsOf(cells);
  const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
  for (const rn of rowNums) {
    const row = rows[rn];
    const texts = Object.values(row).filter((v) => typeof v === 'string').map((v) => v.trim());
    if (texts.includes('매출 금액') && texts.includes('누적 집계 포함')) {
      texts.forEach((t) => set.add(t));
      return set;
    }
  }
  // no dedicated header row - fall back to every string cell
  for (const rn of rowNums) {
    for (const v of Object.values(rows[rn])) {
      if (typeof v === 'string') set.add(v.trim());
    }
  }
  return set;
}

function allLabelTexts(cells) {
  const set = new Set();
  if (!cells) return set;
  for (const v of Object.values(cells)) {
    if (typeof v === 'string') set.add(v.trim());
  }
  return set;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function diffSnapshot(prev, next, workbookPath) {
  prev = prev || {};
  const prevCumulative = num(prev.cumulativeRevenue);
  const nextCumulative = num(next.cumulativeRevenue);
  const prevWeekly = num(prev.weeklyRevenue);
  const nextWeekly = num(next.weeklyRevenue);
  const prevReportWeek =
    prev.reportWeek === undefined || prev.reportWeek === null ? null : prev.reportWeek;
  const nextReportWeek = next.reportWeek;
  const crosscheckDiff = Math.abs(
    next.cumulativeRevenue - next.cumulativeRevenueVerification
  );

  return {
    workbookPath,
    prevCumulative,
    nextCumulative,
    cumulativeDelta:
      prevCumulative === null ? nextCumulative : nextCumulative - prevCumulative,
    prevWeekly,
    nextWeekly,
    prevReportWeek,
    nextReportWeek,
    weekStart: next.weekStart,
    weekEnd: next.weekEnd,
    target: next.annualTarget,
    crosscheckDiff,
    validation: crosscheckDiff < 1 ? 'PASS' : 'FAIL',
  };
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------

module.exports = {
  unzipXlsx,
  parseSharedStrings,
  parseSheet,
  loadWorkbook,
  sumCumulative,
  excelSerialToISO,
  extractSnapshot,
  validateSnapshot,
  diffSnapshot,
  // internal helpers exported for the CLI / tests
  xmlDecode,
  valueForLabel,
};
