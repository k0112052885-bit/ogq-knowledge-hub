'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const core = require('../../revenue-refresh-core.js');
const {
  unzipXlsx,
  parseSharedStrings,
  parseSheet,
  loadWorkbook,
  sumCumulative,
  excelSerialToISO,
  extractSnapshot,
  validateSnapshot,
  diffSnapshot,
} = core;

const {
  businessWeek,
} = require('../../server/handlers/revenue-summary.js');

// ---------------------------------------------------------------------------
// Zero-dependency ZIP writer (stored + streamed entries)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * makeZip(entries, opts)
 *   entries: [{ name, data(Buffer|string), streamed?:bool, method?:0|8,
 *               trailingBytes?:Buffer, lieLocalSizes?:bool, ddSignature?:bool }]
 *
 * - Normal stored entry: method 0, sizes in local header.
 * - streamed entry: local header has generalPurposeBitFlag = 0x0008,
 *   compressedSize = 0 & uncompressedSize = 0, payload (deflateRaw when
 *   method 8), a 16-byte data descriptor (optional 0x08074b50 sig + crc +
 *   compressedSize + uncompressedSize), then optional trailingBytes.
 * - lieLocalSizes: write deliberately WRONG (0) sizes in the local header
 *   while the central directory carries the correct ones.
 * - The central directory always carries the REAL method / compressedSize /
 *   uncompressedSize + local-header offset. EOCD is correct.
 */
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const method = e.method != null ? e.method : e.streamed ? 8 : 0;
    const streamed = !!e.streamed;
    const crc = crc32(raw);
    const comp =
      method === 8 ? zlib.deflateRawSync(raw) : Buffer.from(raw);
    const compressedSize = comp.length;
    const uncompressedSize = raw.length;
    const nameBuf = Buffer.from(e.name, 'utf8');
    const gpbf = streamed ? 0x0008 : 0x0000;

    const localSizesLie = streamed || e.lieLocalSizes;
    const lhCompressed = localSizesLie ? 0 : compressedSize;
    const lhUncompressed = localSizesLie ? 0 : uncompressedSize;
    const lhCrc = streamed ? 0 : crc;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(gpbf, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(lhCrc, 14);
    lh.writeUInt32LE(lhCompressed, 18);
    lh.writeUInt32LE(lhUncompressed, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len

    const localHeaderOffset = offset;
    chunks.push(lh, nameBuf, comp);
    offset += lh.length + nameBuf.length + comp.length;

    if (streamed) {
      const withSig = e.ddSignature !== false; // default: include signature
      const dd = Buffer.alloc(withSig ? 16 : 12);
      let p = 0;
      if (withSig) {
        dd.writeUInt32LE(0x08074b50, 0);
        p = 4;
      }
      dd.writeUInt32LE(crc, p);
      dd.writeUInt32LE(compressedSize, p + 4);
      dd.writeUInt32LE(uncompressedSize, p + 8);
      chunks.push(dd);
      offset += dd.length;
    }

    if (e.trailingBytes && e.trailingBytes.length) {
      chunks.push(Buffer.from(e.trailingBytes));
      offset += e.trailingBytes.length;
    }

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(gpbf, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressedSize, 20); // authoritative
    ch.writeUInt32LE(uncompressedSize, 24); // authoritative
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra len
    ch.writeUInt16LE(0, 32); // comment len
    ch.writeUInt16LE(0, 34); // disk number start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(localHeaderOffset, 42);
    central.push(Buffer.concat([ch, nameBuf]));
  }

  const cdBuf = Buffer.concat(central);
  const cdOffset = offset;
  chunks.push(cdBuf);
  offset += cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// XLSX fixture builder
// ---------------------------------------------------------------------------

function col(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows) {
  // rows: array of arrays; each cell is { v, s } where s means shared-string index,
  // or { n } for a numeric literal, or { inline } for inline string.
  let body = '';
  rows.forEach((cells, ri) => {
    const rowNum = ri + 1;
    let rowXml = '<row r="' + rowNum + '">';
    cells.forEach((cell, ci) => {
      if (cell == null) return;
      const ref = col(ci + 1) + rowNum;
      if (cell.s !== undefined) {
        rowXml += '<c r="' + ref + '" t="s"><v>' + cell.s + '</v></c>';
      } else if (cell.inline !== undefined) {
        rowXml +=
          '<c r="' + ref + '" t="inlineStr"><is><t>' + cell.inline + '</t></is></c>';
      } else if (cell.n !== undefined) {
        rowXml += '<c r="' + ref + '"><v>' + cell.n + '</v></c>';
      }
    });
    rowXml += '</row>';
    body += rowXml;
  });
  return (
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    body +
    '</sheetData></worksheet>'
  );
}

// Deterministic fixture constants (NOT the real workbook numbers).
const F = {
  cumulative: 5_000_000_000, // 50억
  weekly: 120_000_000,
  target: 8_000_000_000,
  reportWeek: 35,
  anchorWeek: 29,
  anchorStartSerial: 46220, // 2026-07-17 (Friday)
  weekStartSerial: 46281, // 2026-09-18? recomputed below
};

// Compute serials so week 35 => Fri 2026-08-28 .. Thu 2026-09-03
function isoToSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}
const WEEK_START_ISO = '2026-08-28';
const WEEK_END_ISO = '2026-09-03';
const ANCHOR_ISO = '2026-07-17';

function buildSharedStrings(list) {
  const sis = list
    .map((s) => (s === null ? '<si/>' : '<si><t>' + s + '</t></si>'))
    .join('');
  return (
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
    list.length +
    '" uniqueCount="' +
    list.length +
    '">' +
    sis +
    '</sst>'
  );
}

/**
 * buildXlsx(opts)
 *   opts.omitCalendar        -> drop 04_Calendar
 *   opts.rawHeaderNoInclude  -> raw header missing '누적 집계 포함'
 *   opts.verificationOffBy   -> add N to the 03_Summary verification value
 *   opts.anchorSerial        -> override anchor start serial (non-Friday etc.)
 *   opts.weekStartSerial/opts.weekEndSerial -> override calendar row
 *   opts.filename            -> just for reference (caller passes basename)
 */
function buildXlsx(opts) {
  opts = opts || {};

  const strings = [];
  const si = (s) => {
    const idx = strings.indexOf(s);
    if (idx >= 0) return idx;
    strings.push(s);
    return strings.length - 1;
  };

  // --- 02_Raw_Data ---
  const amtLbl = si('매출 금액');
  const incLbl = si('누적 집계 포함');
  const nameLbl = si('거래명');
  const rawRows = [];
  if (opts.rawHeaderNoInclude) {
    rawRows.push([{ s: nameLbl }, { s: amtLbl }]);
    rawRows.push([{ inline: 'row1' }, { n: 3_000_000_000 }]);
    rawRows.push([{ inline: 'row2' }, { n: 2_000_000_000 }]);
  } else {
    rawRows.push([{ s: nameLbl }, { s: amtLbl }, { s: incLbl }]);
    // Included rows summing to F.cumulative.
    rawRows.push([{ inline: 'a' }, { n: 3_000_000_000 }, { n: 1 }]);
    rawRows.push([{ inline: 'b' }, { n: 2_000_000_000 }, { n: 1 }]);
    // Excluded row (must NOT be counted).
    rawRows.push([{ inline: 'c' }, { n: 999_999_999 }, { n: 0 }]);
  }

  // --- 03_Summary ---
  const cumLbl = si('연간 누적 매출');
  const wkLbl = si('이번 주 매출');
  const verifVal = F.cumulative + (opts.verificationOffBy || 0);
  const summaryRows = [
    [{ s: si('항목') }, { s: si('설명') }, { s: si('값') }],
    [{ s: cumLbl }, { inline: '연간 누적' }, { n: verifVal }],
    [{ s: wkLbl }, { inline: '이번 주' }, { n: F.weekly }],
  ];

  // --- 04_Calendar ---
  const wkNumLbl = si('주차');
  const wkRangeLbl = si('주간 기간');
  const wsSerial = opts.weekStartSerial != null ? opts.weekStartSerial : isoToSerial(WEEK_START_ISO);
  const weSerial = opts.weekEndSerial != null ? opts.weekEndSerial : isoToSerial(WEEK_END_ISO);
  const wsISO = excelSerialToISO(wsSerial);
  const weISO = excelSerialToISO(weSerial);
  const calRows = [
    [{ s: wkNumLbl }, { s: wkRangeLbl }],
    [{ n: 34 }, { inline: '2026-08-21 ~ 2026-08-27' }],
    [{ n: F.reportWeek }, { inline: wsISO + ' ~ ' + weISO }],
    [{ n: 36 }, { inline: '2026-09-04 ~ 2026-09-10' }],
  ];

  // --- 06_Settings ---
  const anchorSerial = opts.anchorSerial != null ? opts.anchorSerial : isoToSerial(ANCHOR_ISO);
  const settingsRows = [
    [{ s: si('설정') }, { s: si('값') }],
    [{ s: si('연간 목표 매출') }, { n: F.target }],
    [{ s: si('리포트 기준 주차') }, { n: F.reportWeek }],
    [{ s: si('앵커 주차') }, { n: F.anchorWeek }],
    [{ s: si('앵커 시작일') }, { n: anchorSerial }],
  ];

  const sharedStringsXml = buildSharedStrings(strings);

  const sheetDefs = [
    { name: '02_Raw_Data', file: 'sheet1.xml', xml: sheetXml(rawRows) },
    { name: '03_Summary', file: 'sheet2.xml', xml: sheetXml(summaryRows) },
  ];
  if (!opts.omitCalendar) {
    sheetDefs.push({ name: '04_Calendar', file: 'sheet3.xml', xml: sheetXml(calRows) });
  }
  sheetDefs.push({ name: '06_Settings', file: 'sheet4.xml', xml: sheetXml(settingsRows) });

  const workbookXml =
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheetDefs
      .map(
        (s, i) =>
          '<sheet name="' + s.name + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'
      )
      .join('') +
    '</sheets></workbook>';

  const relsXml =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetDefs
      .map(
        (s, i) =>
          '<Relationship Id="rId' +
          (i + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/' +
          s.file +
          '"/>'
      )
      .join('') +
    '</Relationships>';

  const contentTypes =
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>';

  const zipEntries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: workbookXml, streamed: true },
    { name: 'xl/_rels/workbook.xml.rels', data: relsXml },
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml, streamed: true },
  ];
  for (const s of sheetDefs) {
    zipEntries.push({ name: 'xl/worksheets/' + s.file, data: s.xml, method: 8 });
  }
  // Simulate an ignored VBA project part.
  zipEntries.push({ name: 'xl/vbaProject.bin', data: Buffer.from([1, 2, 3, 4]) });

  return makeZip(zipEntries);
}

const VALID_NAME = 'OGQ_매출현황_2026.xlsm';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('1. valid xlsx fixture -> extractSnapshot returns 8-field contract', () => {
  const buf = buildXlsx();
  const snap = extractSnapshot(buf, VALID_NAME);
  assert.deepStrictEqual(Object.keys(snap).sort(), [
    'annualTarget',
    'cumulativeRevenue',
    'cumulativeRevenueVerification',
    'reportWeek',
    'weekAnchor',
    'weekEnd',
    'weekStart',
    'weeklyRevenue',
  ].sort());
  assert.strictEqual(snap.cumulativeRevenue, F.cumulative);
  assert.strictEqual(snap.cumulativeRevenueVerification, F.cumulative);
  assert.strictEqual(snap.weeklyRevenue, F.weekly);
  assert.strictEqual(snap.annualTarget, F.target);
  assert.strictEqual(snap.reportWeek, F.reportWeek);
  assert.deepStrictEqual(snap.weekAnchor, {
    anchorWeek: F.anchorWeek,
    anchorStartDate: ANCHOR_ISO,
  });
  assert.strictEqual(snap.weekStart, WEEK_START_ISO);
  assert.strictEqual(snap.weekEnd, WEEK_END_ISO);
});

test('2. sumCumulative includes only 누적 집계 포함 == 1 rows', () => {
  const buf = buildXlsx();
  const wb = loadWorkbook(buf);
  const total = sumCumulative(wb.sheets['02_Raw_Data']);
  assert.strictEqual(total, F.cumulative); // 999,999,999 excluded row omitted
});

test('3. cross-check < 1 KRW -> CUMULATIVE_CROSSCHECK ok', () => {
  const buf = buildXlsx();
  const wb = loadWorkbook(buf);
  const snap = extractSnapshot(buf, VALID_NAME);
  const res = validateSnapshot(snap, wb, VALID_NAME);
  const gate = res.gates.find((g) => g.name === 'CUMULATIVE_CROSSCHECK');
  assert.strictEqual(gate.ok, true);
  assert.strictEqual(res.ok, true);
});

test('4. cross-check >= 1 KRW (verification off by 2) -> validate fails', () => {
  const buf = buildXlsx({ verificationOffBy: 2 });
  const wb = loadWorkbook(buf);
  const snap = extractSnapshot(buf, VALID_NAME);
  const res = validateSnapshot(snap, wb, VALID_NAME);
  assert.strictEqual(res.ok, false);
  const gate = res.gates.find((g) => g.name === 'CUMULATIVE_CROSSCHECK');
  assert.strictEqual(gate.ok, false);
});

test('5. fixture missing 04_Calendar -> validate fails', () => {
  const buf = buildXlsx({ omitCalendar: true });
  const wb = loadWorkbook(buf);
  const snap = extractSnapshot(buf, VALID_NAME);
  const res = validateSnapshot(snap, wb, VALID_NAME);
  assert.strictEqual(res.ok, false);
  const gate = res.gates.find((g) => g.name === 'WORKBOOK_IDENTITY');
  assert.strictEqual(gate.ok, false);
});

test('6. raw header without 누적 집계 포함 -> SCHEMA fails / sumCumulative throws', () => {
  const buf = buildXlsx({ rawHeaderNoInclude: true });
  const wb = loadWorkbook(buf);
  assert.throws(() => sumCumulative(wb.sheets['02_Raw_Data']), /EMPTY_CUMULATIVE/);
  // validateSnapshot receives a snapshot-shaped object; build a minimal one.
  const snap = {
    cumulativeRevenue: 0,
    cumulativeRevenueVerification: 0,
    weeklyRevenue: F.weekly,
    annualTarget: F.target,
    reportWeek: F.reportWeek,
    weekAnchor: { anchorWeek: F.anchorWeek, anchorStartDate: ANCHOR_ISO },
    weekStart: WEEK_START_ISO,
    weekEnd: WEEK_END_ISO,
  };
  const res = validateSnapshot(snap, wb, VALID_NAME);
  assert.strictEqual(res.ok, false);
  const gate = res.gates.find((g) => g.name === 'SCHEMA');
  assert.strictEqual(gate.ok, false);
});

test('7. anchorStartDate not a Friday -> BUSINESS_WEEK fails', () => {
  // 2026-07-18 is a Saturday.
  const badAnchor = isoToSerial('2026-07-18');
  const buf = buildXlsx({ anchorSerial: badAnchor });
  const wb = loadWorkbook(buf);
  const snap = extractSnapshot(buf, VALID_NAME);
  const res = validateSnapshot(snap, wb, VALID_NAME);
  const gate = res.gates.find((g) => g.name === 'BUSINESS_WEEK');
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(res.ok, false);
});

test('7b. calendar row for reportWeek not Fri->Thu -> BUSINESS_WEEK fails', () => {
  const buf = buildXlsx({
    weekStartSerial: isoToSerial('2026-08-29'), // Saturday
    weekEndSerial: isoToSerial('2026-09-04'),
  });
  const wb = loadWorkbook(buf);
  const snap = extractSnapshot(buf, VALID_NAME);
  const res = validateSnapshot(snap, wb, VALID_NAME);
  const gate = res.gates.find((g) => g.name === 'BUSINESS_WEEK');
  assert.strictEqual(gate.ok, false);
});

test('8. parseSharedStrings: [<si><t>a</t></si>, <si/>, <si><t>b</t></si>] -> ["a","b"]', () => {
  const xml =
    '<sst><si><t>a</t></si><si/><si><t>b</t></si></sst>';
  assert.deepStrictEqual(parseSharedStrings(xml), ['a', 'b']);
});

test('9. businessWeek: Fri advances, Thu stays', () => {
  const anchor = { anchorWeek: 29, anchorStartDate: '2026-07-17' };
  assert.strictEqual(businessWeek(new Date(Date.UTC(2026, 7, 28)), anchor), 35);
  assert.strictEqual(businessWeek(new Date(Date.UTC(2026, 7, 27)), anchor), 34);
});

test('10. businessWeek(2026-09-03) === 35', () => {
  const anchor = { anchorWeek: 29, anchorStartDate: '2026-07-17' };
  assert.strictEqual(businessWeek(new Date(Date.UTC(2026, 8, 3)), anchor), 35);
});

test('11. diffSnapshot prev/next cumulative + delta', () => {
  const prev = {
    cumulativeRevenue: 4_000_000_000,
    weeklyRevenue: 100_000_000,
    reportWeek: 34,
  };
  const next = {
    cumulativeRevenue: 5_000_000_000,
    cumulativeRevenueVerification: 5_000_000_000,
    weeklyRevenue: 120_000_000,
    reportWeek: 35,
    annualTarget: F.target,
    weekStart: WEEK_START_ISO,
    weekEnd: WEEK_END_ISO,
  };
  const d = diffSnapshot(prev, next, '/tmp/x.xlsm');
  assert.strictEqual(d.prevCumulative, 4_000_000_000);
  assert.strictEqual(d.nextCumulative, 5_000_000_000);
  assert.strictEqual(d.cumulativeDelta, 1_000_000_000);
  assert.strictEqual(d.prevWeekly, 100_000_000);
  assert.strictEqual(d.nextWeekly, 120_000_000);
});

test('12. diffSnapshot prevReportWeek / nextReportWeek', () => {
  const d = diffSnapshot(
    { reportWeek: 34, cumulativeRevenue: 1 },
    {
      reportWeek: 35,
      cumulativeRevenue: 2,
      cumulativeRevenueVerification: 2,
      weekStart: WEEK_START_ISO,
      weekEnd: WEEK_END_ISO,
    },
    '/tmp/x.xlsm'
  );
  assert.strictEqual(d.prevReportWeek, 34);
  assert.strictEqual(d.nextReportWeek, 35);

  const d2 = diffSnapshot(null, { reportWeek: 35, cumulativeRevenue: 2, cumulativeRevenueVerification: 2 }, '/tmp/x');
  assert.strictEqual(d2.prevReportWeek, null);
  assert.strictEqual(d2.nextReportWeek, 35);
});

test('13. CLI main against failing fixture leaves temp revenue-workbook.json byte-identical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-fail-'));
  const cwd = process.cwd();
  try {
    const xlsm = path.join(dir, VALID_NAME);
    fs.writeFileSync(xlsm, buildXlsx({ verificationOffBy: 2 }));
    const snapPath = path.join(dir, 'revenue-workbook.json');
    const original = JSON.stringify({ sentinel: true }, null, 2) + '\n';
    fs.writeFileSync(snapPath, original);

    process.chdir(dir);
    delete require.cache[require.resolve('../../revenue-refresh.js')];
    const { main } = require('../../revenue-refresh.js');
    const code = main(['node', 'revenue-refresh.js', xlsm]);
    assert.notStrictEqual(code, 0);
    assert.strictEqual(fs.readFileSync(snapPath, 'utf8'), original);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('14. CLI main --apply writes 8-key contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-apply-'));
  const cwd = process.cwd();
  try {
    const xlsm = path.join(dir, VALID_NAME);
    fs.writeFileSync(xlsm, buildXlsx());
    process.chdir(dir);
    delete require.cache[require.resolve('../../revenue-refresh.js')];
    const { main } = require('../../revenue-refresh.js');
    const code = main(['node', 'revenue-refresh.js', xlsm, '--apply']);
    assert.strictEqual(code, 0);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'revenue-workbook.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(written).sort(), [
      'annualTarget',
      'cumulativeRevenue',
      'cumulativeRevenueVerification',
      'reportWeek',
      'weekAnchor',
      'weekEnd',
      'weekStart',
      'weeklyRevenue',
    ].sort());
    assert.deepStrictEqual(Object.keys(written.weekAnchor).sort(), [
      'anchorStartDate',
      'anchorWeek',
    ]);
    assert.strictEqual(written.weekAnchor.anchorWeek, F.anchorWeek);
    assert.strictEqual(written.weekAnchor.anchorStartDate, ANCHOR_ISO);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('15. CLI --apply never modifies the source workbook (bytes + mtime)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-src-'));
  const cwd = process.cwd();
  try {
    const xlsm = path.join(dir, VALID_NAME);
    const bytes = buildXlsx();
    fs.writeFileSync(xlsm, bytes);
    const before = fs.readFileSync(xlsm);
    const beforeStat = fs.statSync(xlsm);

    process.chdir(dir);
    delete require.cache[require.resolve('../../revenue-refresh.js')];
    const { main } = require('../../revenue-refresh.js');
    main(['node', 'revenue-refresh.js', xlsm, '--apply']);

    const after = fs.readFileSync(xlsm);
    const afterStat = fs.statSync(xlsm);
    assert.ok(before.equals(after));
    assert.strictEqual(beforeStat.mtimeMs, afterStat.mtimeMs);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('16. STREAMED-ZIP regression: streamed entry round-trips', () => {
  const payload = Buffer.from('streamed-entry-payload-' + 'x'.repeat(500), 'utf8');
  const buf = makeZip([{ name: 'part.xml', data: payload, streamed: true }]);
  const out = unzipXlsx(buf);
  assert.ok(out['part.xml']);
  assert.deepStrictEqual(out['part.xml'], payload);
});

test('17. central-directory authority: wrong local sizes still decompress', () => {
  const payload = Buffer.from('central-directory-is-authoritative '.repeat(20), 'utf8');
  const buf = makeZip([
    { name: 'lies.xml', data: payload, method: 8, lieLocalSizes: true },
  ]);
  const out = unzipXlsx(buf);
  assert.deepStrictEqual(out['lies.xml'], payload);
});

test('18. data-descriptor bytes not consumed as payload', () => {
  const payload = Buffer.from('exact-payload-no-trailing-bytes', 'utf8');
  const trailing = Buffer.from('!!TRAILING-RECOGNIZABLE-BYTES!!', 'utf8');
  const buf = makeZip([
    { name: 'dd.xml', data: payload, streamed: true, trailingBytes: trailing },
  ]);
  const out = unzipXlsx(buf);
  assert.deepStrictEqual(out['dd.xml'], payload);
  assert.strictEqual(out['dd.xml'].length, payload.length);
});

test('bonus: parseSheet returns flat {A1:value} map incl inline strings + shared', () => {
  const shared = ['hello'];
  const xml = sheetXml([
    [{ s: 0 }, { n: 42 }],
    [{ inline: 'world' }],
  ]);
  const cells = parseSheet(xml, shared);
  assert.strictEqual(cells.A1, 'hello');
  assert.strictEqual(cells.B1, '42');
  assert.strictEqual(cells.A2, 'world');
  assert.deepStrictEqual(parseSheet('', shared), {});
  assert.deepStrictEqual(parseSheet(undefined, shared), {});
});

test('bonus: unzipXlsx round-trips a normal stored entry + throws on bad EOCD', () => {
  const payload = Buffer.from('stored', 'utf8');
  const buf = makeZip([{ name: 'a.txt', data: payload }]);
  assert.deepStrictEqual(unzipXlsx(buf)['a.txt'], payload);
  assert.throws(() => unzipXlsx(Buffer.from('not a zip at all')), /ZIP_EOCD_NOT_FOUND/);
});

test('bonus: excelSerialToISO', () => {
  assert.strictEqual(excelSerialToISO(isoToSerial('2026-07-17')), '2026-07-17');
  assert.strictEqual(excelSerialToISO(isoToSerial('2026-09-03')), '2026-09-03');
});
