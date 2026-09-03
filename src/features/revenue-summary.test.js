const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  computeRevenueSummary,
  computeWeeklyProgress,
  selectWeeklyActions,
} = require("../../server/handlers/revenue-summary.js");

const weeklyActionsPath = path.join(__dirname, "..", "..", "weekly-actions.json");

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
  assert.ok(src.includes("data.targetRevenue"));
  assert.ok(!/\b2000000000\b/.test(src));
  assert.ok(!/\b2_000_000_000\b/.test(src));
});

test("weekly: week number for a fixed date (Sept 3 2026 => week 36)", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  const expected = Math.ceil((Math.floor((Date.UTC(2026, 8, 3) - Date.UTC(2026, 0, 1)) / 86400000) + 1) / 7);
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now).weekNumber, expected);
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now).weekNumber, 36);
});

test("weekly: annual time progress for a fixed non-leap date (2026, dayOfYear 246, /365)", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now).timeProgressPercent, (246 / 365) * 100);
});

test("weekly: revenue progress = cumulative / target * 100 for a fixed date", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  assert.strictEqual(
    computeWeeklyProgress(2359437328, 5000000000, now).revenueProgressPercent,
    (2359437328 / 5000000000) * 100
  );
});

test("weekly: differencePoints identity = revenueProgress - timeProgress for a fixed pair", () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  const r = computeWeeklyProgress(2359437328, 5000000000, now);
  assert.strictEqual(r.differencePoints, r.revenueProgressPercent - r.timeProgressPercent);
});

test("weekly: leap-year total-days branch uses /366 (June 15 2024)", () => {
  const now = new Date(Date.UTC(2024, 5, 15));
  const dayOfYear = Math.floor((Date.UTC(2024, 5, 15) - Date.UTC(2024, 0, 1)) / 86400000) + 1;
  assert.strictEqual(computeWeeklyProgress(1, 5000000000, now).timeProgressPercent, (dayOfYear / 366) * 100);
});

test("first slice still works: attainmentPercent = cumulative / target * 100", () => {
  assert.strictEqual(
    computeRevenueSummary({ cumulativeRevenue: 1234567890, targetRevenue: 5000000000 }).attainmentPercent,
    (1234567890 / 5000000000) * 100
  );
});

test("weekly-actions: reuse computeWeeklyProgress week number (Sept 3 2026 => 36)", () => {
  assert.strictEqual(
    computeWeeklyProgress(1, 5000000000, new Date(Date.UTC(2026, 8, 3))).weekNumber,
    36
  );
});

test("weekly-actions: selectWeeklyActions returns the record whose .week === 36", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const rec = selectWeeklyActions(records, 36);
  assert.ok(rec);
  assert.strictEqual(rec.week, 36);
  assert.ok(Array.isArray(rec.currentActions));
  assert.ok(rec.currentActions.length > 0);
});

test("weekly-actions: fixed-date end-to-end selection resolves to week 36 record", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const wk = computeWeeklyProgress(1, 5000000000, new Date(Date.UTC(2026, 8, 3))).weekNumber;
  const rec = selectWeeklyActions(records, wk);
  assert.ok(rec && rec.week === 36);
});

test("weekly-actions: current action fields are non-empty strings", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const rec = selectWeeklyActions(records, 36);
  assert.strictEqual(typeof rec.currentActions[0].title, "string");
  assert.ok(rec.currentActions[0].title.length > 0);
  assert.strictEqual(typeof rec.currentActions[0].status, "string");
  assert.ok(rec.currentActions[0].status.length > 0);
});

test("weekly-actions: previous effect fields are non-empty strings", () => {
  const records = JSON.parse(fs.readFileSync(weeklyActionsPath, "utf8"));
  const rec = selectWeeklyActions(records, 36);
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
    computeWeeklyProgress(2359437328, 5000000000, new Date(Date.UTC(2026, 8, 3))).differencePoints,
    (2359437328 / 5000000000) * 100 - (246 / 365) * 100
  );
});
