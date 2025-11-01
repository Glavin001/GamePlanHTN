import { performance } from "node:perf_hooks";
import { test } from "uvu";
import * as assert from "uvu/assert";
import { planGoal } from "./bunkerDomain";

function expectInOrder(lines: string[], tokens: string[]) {
  let prevIndex = -1;
  for (const token of tokens) {
    const index = lines.indexOf(token);
    assert.ok(index >= 0, `Token "${token}" not found in plan: ${JSON.stringify(lines)}`);
    assert.ok(index > prevIndex, `Token "${token}" occurs out of order in plan: ${JSON.stringify(lines)}`);
    prevIndex = index;
  }
}

test("adjacent move via goal (courtyard -> bunker_door)", () => {
  const lines = planGoal({ agentAt: "bunker_door" });
  assert.ok(lines.length >= 1);
  assert.is(lines[0], "MOVE bunker_door");
});

test("goal hasKey should generate pickup sequence", () => {
  const lines = planGoal({ hasKey: true });
  assert.is(lines[0], "MOVE table_area");
  assert.ok(lines.includes("PICKUP_KEY"));
});

test("hasC4 plan unlocks storage and picks up C4", () => {
  const lines = planGoal({ hasC4: true });
  expectInOrder(lines, ["MOVE table_area", "PICKUP_KEY"]);
  assert.ok(lines.includes("UNLOCK_STORAGE"));
  assert.ok(lines.includes("PICKUP_C4"));
  expectInOrder(lines, ["UNLOCK_STORAGE", "PICKUP_C4"]);
});

test("bunkerBreached plan places C4 and detonates", () => {
  const lines = planGoal({ bunkerBreached: true });
  assert.ok(lines.includes("PLACE_C4"));
  assert.ok(lines.includes("DETONATE"));
  expectInOrder(lines, ["PLACE_C4", "DETONATE"]);
});

test("hasStar plan completes full mission and picks up star", () => {
  const lines = planGoal({ hasStar: true });
  expectInOrder(lines, [
    "MOVE table_area",
    "PICKUP_KEY",
    "UNLOCK_STORAGE",
    "PICKUP_C4",
    "PLACE_C4",
    "DETONATE",
    "MOVE bunker_interior",
    "MOVE star_pos",
    "PICKUP_STAR",
  ]);
  assert.is(lines[lines.length - 1], "PICKUP_STAR");
});

test("hasStar + agentAt=table_area returns with star to table in one plan", () => {
  const lines = planGoal({ hasStar: true, agentAt: "table_area" });
  const starIndex = lines.indexOf("PICKUP_STAR");
  const returnIndex = lines.lastIndexOf("MOVE table_area");
  assert.ok(starIndex >= 0, `PICKUP_STAR not found in plan: ${JSON.stringify(lines)}`);
  assert.ok(returnIndex > starIndex, `MOVE table_area does not appear after PICKUP_STAR: ${JSON.stringify(lines)}`);
  assert.is(lines[lines.length - 1], "MOVE table_area");
});

test("does not place or detonate C4 if bunker already breached", () => {
  const lines = planGoal({ hasStar: true }, { initial: { bunkerBreached: true } });
  assert.not.ok(lines.includes("PLACE_C4"));
  assert.not.ok(lines.includes("DETONATE"));
  assert.not.ok(lines.includes("PICKUP_KEY"));
  assert.not.ok(lines.includes("UNLOCK_STORAGE"));
  assert.not.ok(lines.includes("PICKUP_C4"));
  assert.ok(lines.includes("MOVE bunker_interior"));
  assert.ok(lines.includes("MOVE star_pos"));
  assert.ok(lines.includes("PICKUP_STAR"));
  assert.is(lines[lines.length - 1], "PICKUP_STAR");
});

test("C4 already placed: skips key/storage, detonates, then continues to star", () => {
  const lines = planGoal({ hasStar: true }, { initial: { c4Placed: true } });
  assert.not.ok(lines.includes("PICKUP_KEY"));
  assert.not.ok(lines.includes("UNLOCK_STORAGE"));
  assert.not.ok(lines.includes("PICKUP_C4"));
  assert.not.ok(lines.includes("PLACE_C4"));
  assert.ok(lines.includes("DETONATE"));
  const safeIndex = lines.indexOf("MOVE blast_safe_zone");
  const detonateIndex = lines.indexOf("DETONATE");
  assert.ok(safeIndex >= 0);
  assert.ok(detonateIndex > safeIndex);
  assert.ok(lines.includes("MOVE bunker_interior"));
  assert.ok(lines.includes("MOVE star_pos"));
  assert.ok(lines.includes("PICKUP_STAR"));
  assert.is(lines[lines.length - 1], "PICKUP_STAR");
});

test("storage already unlocked: skips key, goes straight to C4, continues to star", () => {
  const lines = planGoal({ hasStar: true }, { initial: { storageUnlocked: true } });
  assert.not.ok(lines.includes("PICKUP_KEY"));
  assert.not.ok(lines.includes("UNLOCK_STORAGE"));
  assert.ok(lines.includes("MOVE storage_door"));
  assert.ok(lines.includes("MOVE c4_table"));
  assert.ok(lines.includes("PICKUP_C4"));
  assert.ok(lines.includes("PLACE_C4"));
  assert.ok(lines.includes("MOVE blast_safe_zone"));
  assert.ok(lines.includes("DETONATE"));
  assert.ok(lines.includes("MOVE bunker_interior"));
  assert.ok(lines.includes("MOVE star_pos"));
  assert.ok(lines.includes("PICKUP_STAR"));
  assert.is(lines[lines.length - 1], "PICKUP_STAR");
});

test("target is storage interior: picks up key, unlocks storage, moves to storage interior", () => {
  const lines = planGoal({ agentAt: "storage_interior" });
  assert.ok(lines.includes("PICKUP_KEY"));
  assert.ok(lines.includes("UNLOCK_STORAGE"));
  assert.ok(lines.includes("MOVE storage_interior"));
  assert.not.ok(lines.includes("PICKUP_C4"));
  assert.not.ok(lines.includes("PLACE_C4"));
  assert.not.ok(lines.includes("DETONATE"));
  assert.not.ok(lines.includes("PICKUP_STAR"));
  assert.not.ok(lines.includes("MOVE star_pos"));
  assert.not.ok(lines.includes("MOVE bunker_interior"));
  const lastMoveIndex = lines.lastIndexOf("MOVE storage_interior");
  assert.ok(lastMoveIndex >= 0);
  assert.is(lines[lastMoveIndex], "MOVE storage_interior");
});

test("goal hasKey and hasC4 picks up key and C4", () => {
  const lines = planGoal({ hasKey: true, hasC4: true });
  expectInOrder(lines, [
    "MOVE table_area",
    "PICKUP_KEY",
    "MOVE storage_door",
    "UNLOCK_STORAGE",
    "MOVE c4_table",
    "PICKUP_C4",
  ]);
  assert.not.ok(lines.includes("PICKUP_STAR"));
  assert.not.ok(lines.includes("PLACE_C4"));
  assert.not.ok(lines.includes("DETONATE"));
  assert.not.ok(lines.includes("MOVE star_pos"));
  assert.is(lines[lines.length - 1], "PICKUP_C4");
});

test("performance baseline for hasStar goal", () => {
  const baseline = planGoal({ hasStar: true });
  assert.ok(baseline.length > 0, "Baseline plan should not be empty");

  const iterations = 2000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    planGoal({ hasStar: true });
  }
  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const fps = avgMs === 0 ? Number.POSITIVE_INFINITY : 1000 / avgMs;

  // eslint-disable-next-line no-console -- Explicitly requested performance logging
  console.log(
    `[BunkerPerf] iterations=${iterations} total=${totalMs.toFixed(2)}ms avg=${avgMs.toFixed(4)}ms fps=${fps.toFixed(2)}`,
  );

  assert.ok(Number.isFinite(avgMs) && avgMs >= 0, "Average time should be finite and non-negative");
});

test.run();

