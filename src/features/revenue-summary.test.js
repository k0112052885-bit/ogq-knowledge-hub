const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  computeRevenueSummary,
  computeWeeklyProgress,
  selectWeeklyActions,
  businessWeek,
} = require("../../server/handlers/revenue-summary.js");

const weeklyActionsPath = path.join(__dirname, "..", "..", "weekly-actions.json");
const workbookPath = path.join(__dirname, "..", "..", "revenue-workbook.json");

const ANCHOR = { anchorWeek: 29, anchorStartDate: "2026-07-17" };

test("target is 5,000,000,000", () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "revenue-target.json"), "utf8"));
  assert.strictEqual(d.targetRevenue, 5000000000);
});

test("attainment = cumulative / target * 100", () => {
  const r = computeRevenueSummary({ cumulativeRevenue: 1234567890, targetRevenue: 5000000000 });
  assert.strictEqual(r.attainmentPercent, (1234567890 / 5000000000) * 100);
});

test("target is echoed from data, not hard-coded", () => {
  const r = computeRevenueSummary({ cumulativeRevenue: 1, targetRevenue: 999 });
  assert.strictEqual(r.targetRevenue, 999);
  assert.strictEqual(r.attainmentPercent, (1 / 999) * 100);
});

test("handler source has no hard-coded current revenue", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "server", "handlers", "revenue-summary.js"), "utf8");
  assert.ok(src.includes("revenue-workbook.json"));
  assert.ok(src.includes("workbook.cumulativeRevenue"));
  assert.ok(src.includes("workbook.annualTarget"));
  assert.ok(!/\b2000000000\b/.test(src));
  assert.ok(!/\b2_000_000_000\b/.test(src));
});

test("snapshot: cumulativeRevenue is approximately 2226623307.18", () => {
  const snapshot = JSON.parse(fs.readFileSync(workbookPath, "utf8"));
  assert.ok(Math.abs(snapshot.cumulativeRevenue - 2226623307.181818) < 1e-6);
});

test("snapshot: cumulative cross-check within 1 KRW", () => {
  const snapshot = JSON.parse(fs.readFileSync(workbookPath, "utf8"));
  assert.ok(Math.abs(snapshot.cumulativeRevenue - snapshot.cumulativeRevenueVerification) < 1);
});

test("snapshot: annualTarget === 5000000000", () => {
  const snapshot = JSON.parse(fs.readFileSync(workbookPath, "utf8"));
  assert.strictEqual(snapshot.annualTarget, 5000000000);
});

test("businessWeek: 2026-09-03 => business week 35", () => {
  assert.strictEqual(businessWeek(new Date(Date.UTC(2026, 8, 3)), ANCHOR), 35);
});

test("businessWeek: Friday 2026-08-28 starts next week => 35", () => {
  assert.strictEqual(businessWeek(new Date(Date.UTC(2026, 7, 28)), ANCHOR), 35);
});

test("businessWeek: Thursday 2026-08-27 stays in current week => 34", () => {
  assert.strictEqual(businessWeek(new Date(Date.UTC(2026, 7, 27)), ANCHOR), 34);
});

test("weekly: week number for a fixed date (Sept 3 2026 => business week 35)", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now, ANCHOR).weekNumber, 35);
});

test("weekly: annual time progress for a fixed non-leap date (2026, dayOfYear 246, /365)", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now, ANCHOR).timeProgressPercent, (246 / 365) * 100);
});

test("weekly: revenue progress = cumulative / target * 100 for a fixed date", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  assert.strictEqual(
    computeWeeklyProgress(2359437328, 5000000000, now, ANCHOR).revenueProgressPercent,
    (2359437328 / 5000000000) * 100
  );
});

test("weekly: differencePoints identity = revenueProgress - timeProgress for a fixed pair", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  const r = computeWeeklyProgress(2359437328, 5000000000, now, ANCHOR);
  assert.strictEqual(r.differencePoints, r.revenueProgressPercent - r.timeProgressPercent);
});

test("weekly: leap-year total-days branch uses /366 (June 15 2024)", () => {
  const now = new Date(Date.UTC(2024, 5, 15));
  const dayOfYear = Math.floor((Date.UTC(2024, 5, 15) - Date.UTC(2024, 0, 1)) / 86400000) + 1;
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now, ANCHOR).timeProgressPercent, (dayOfYear / 366) * 100);
});

test("first slice still works: attainmentPercent = cumulative / target * 100", () => {
  assert.strictEqual(
    computeRevenueSummary({ cumulativeRevenue: 1234567890, targetRevenue: 5000000000 }).attainmentPercent,
    (1234567890 / 5000000000) * 100
  );
});

test("revenue summary uses workbook cumulative/target", () => {
  const snapshot = JSON.parse(fs.readFileSync(workbookPath, "utf8"));
  const r = computeRevenueSummary({
    cumulativeRevenue: snapshot.cumulativeRevenue,
    targetRevenue: snapshot.annualTarget,
  });
  assert.strictEqual(r.attainmentPercent, (2226623307.181818 / 5000000000) * 100);
});

test("weekly progress uses business week (Sept 3 2026 => 35)", () => {
  assert.strictEqual(
    computeWeeklyProgress(1, 5000000000, new Date(Date.UTC(2026, 8, 3)), ANCHOR).weekNumber,
    35
  );
});

test("weekly-actions: reuse computeWeeklyProgress week number (Sept 3 2026 => 35)", () => {
  assert.strictEqual(
    computeWeeklyProgress(1, 5000000000, new Date(Date.UTC(2026, 8, 3)), ANCHOR).weekNumber,
    35
  );
});

test("weekly-actions: selectWeeklyActions returns the record whose .week === 35", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const rec = selectWeeklyActions(records, 35);
  assert.ok(rec);
  assert.strictEqual(rec.week, 35);
  assert.ok(Array.isArray(rec.currentActions));
  assert.ok(rec.currentActions.length > 0);
});

test("weekly-actions: fixed-date end-to-end selection resolves to week 35 record", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const wk = businessWeek(new Date(Date.UTC(2026, 8, 3)), ANCHOR);
  const rec = selectWeeklyActions(records, wk);
  assert.ok(rec && rec.week === 35);
});

test("weekly-actions: current action fields are non-empty strings", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const rec = selectWeeklyActions(records, 35);
  assert.strictEqual(typeof rec.currentActions[0].title, "string");
  assert.ok(rec.currentActions[0].title.length > 0);
  assert.strictEqual(typeof rec.currentActions[0].status, "string");
  assert.ok(rec.currentActions[0].status.length > 0);
});

test("weekly-actions: previous effect fields are non-empty strings", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const rec = selectWeeklyActions(records, 35);
  assert.strictEqual(typeof rec.previousActionEffects[0].actionTitle, "string");
  assert.ok(rec.previousActionEffects[0].actionTitle.length > 0);
  assert.strictEqual(typeof rec.previousActionEffects[0].effectSummary, "string");
  assert.ok(rec.previousActionEffects[0].effectSummary.length > 0);
});

test("weekly-actions: empty state => selectWeeklyActions(records, 99) === null", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  assert.strictEqual(selectWeeklyActions(records, 99), null);
});

test("weekly-actions: first slice still works alongside", () => {
  assert.strictEqual(
    computeRevenueSummary({ cumulativeRevenue: 1234567890, targetRevenue: 5000000000 }).attainmentPercent,
    (1234567890 / 5000000000) * 100
  );
});

test("weekly-actions: weekly-progress differencePoints still works alongside", () => {
  assert.strictEqual(
    computeWeeklyProgress(2359437328, 5000000000, new Date(Date.UTC(2026, 8, 3)), ANCHOR).differencePoints,
    (2359437328 / 5000000000) * 100 - (246 / 365) * 100
  );
});
