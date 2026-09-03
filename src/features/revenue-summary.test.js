const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { computeRevenueSummary } = require("../../server/handlers/revenue-summary.js");

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
