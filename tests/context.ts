import { test } from "uvu";
import * as assert from "uvu/assert";
import ContextState from "../src/contextState";
import EffectType from "../src/effectType";
import * as TestUtil from "./utils";


test("Context defaults to Executing", () => {
  const ctx = TestUtil.getEmptyTestContext();

  assert.is(ctx.ContextState, ContextState.Executing);
});

test("Init Initializes Collections", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  assert.ok(ctx.WorldStateChangeStack);

  // TODO: Evaluate how to handle the MyWorldState concept since we're in JS land
  // assert.is(Enum.GetValues(typeof (MyWorldState)).Length, ctx.WorldStateChangeStack.Length);
  assert.equal(false, ctx.DebugMTR);
  assert.equal(false, ctx.LogDecomposition);
  assert.equal([], ctx.MTRDebug);
  assert.equal([], ctx.LastMTRDebug);
  assert.equal([], ctx.DecompositionLog);
});

test("hasState expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.setState("HasB", 1, true, EffectType.Permanent);

  assert.equal(false, ctx.hasState("HasA"));
  assert.equal(true, ctx.hasState("HasB"));
});

test("setState Planning Context expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Planning;
  ctx.setState("HasB", 1, true, EffectType.Permanent);

  assert.equal(true, ctx.hasState("HasB"));
  const hasAChanges = TestUtil.getWorldStateChangeStack(ctx, "HasA");
  assert.equal(hasAChanges.length, 0);
  const hasBChanges = TestUtil.getWorldStateChangeStack(ctx, "HasB");
  assert.equal(hasBChanges.length, 1);
  const firstHasBChange = hasBChanges[0];
  if (!firstHasBChange) {
    throw new Error("Expected HasB stack to contain an entry");
  }
  assert.equal(firstHasBChange.effectType, EffectType.Permanent);
  assert.equal(firstHasBChange.value, 1);
  assert.equal(ctx.WorldState.HasB, 0);
});

test("setState executing Context expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Executing;
  ctx.setState("HasB", 1, true, EffectType.Permanent);

  assert.ok(ctx.hasState("HasB"));
  const hasBChanges = TestUtil.getWorldStateChangeStack(ctx, "HasB");
  assert.equal(hasBChanges.length, 0);
  assert.equal(ctx.WorldState.HasB, 1);
});


test("GetState planning context expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Planning;
  ctx.setState("HasB", 1, true, EffectType.Permanent);

  assert.equal(0, ctx.getState("HasA"));
  assert.equal(1, ctx.getState("HasB"));
});

test("GetState executing context expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Executing;
  ctx.setState("HasB", 1, true, EffectType.Permanent);

  assert.equal(0, ctx.getState("HasA"));
  assert.equal(1, ctx.getState("HasB"));
});


test("GetWorldStateChangeDepth expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Executing;
  ctx.setState("HasB", 1, true, EffectType.Permanent);
  const changeDepthExecuting = ctx.getWorldStateChangeDepth();

  ctx.ContextState = ContextState.Planning;
  ctx.setState("HasB", 1, true, EffectType.Permanent);
  const changeDepthPlanning = ctx.getWorldStateChangeDepth();

  assert.equal(Object.keys(ctx.WorldStateChangeStack).length, Object.keys(changeDepthExecuting).length);
  assert.equal(changeDepthExecuting.HasA, 0);
  assert.equal(changeDepthExecuting.HasB, 0);

  assert.equal(Object.keys(ctx.WorldStateChangeStack).length, Object.keys(changeDepthPlanning).length);
  assert.equal(changeDepthPlanning.HasA, 0);
  assert.equal(changeDepthPlanning.HasB, 1);
});

test("Trim for execution expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Planning;
  ctx.setState("HasA", 1, true, EffectType.PlanAndExecute);
  ctx.setState("HasB", 1, true, EffectType.Permanent);
  ctx.setState("HasC", 1, true, EffectType.PlanOnly);
  ctx.trimForExecution();

  const hasAChanges = TestUtil.getWorldStateChangeStack(ctx, "HasA");
  const hasBChanges = TestUtil.getWorldStateChangeStack(ctx, "HasB");
  const hasCChanges = TestUtil.getWorldStateChangeStack(ctx, "HasC");
  assert.equal(hasAChanges.length, 0);
  assert.equal(hasBChanges.length, 1);
  assert.equal(hasCChanges.length, 0);
});

test("Trim for execution throws exception on wrong context state", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Executing;
  assert.throws(() =>
    ctx.trimForExecution()
  );
});

test("Trim to stack depth expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Planning;
  ctx.setState("HasA", 1, true, EffectType.PlanAndExecute);
  ctx.setState("HasB", 1, true, EffectType.Permanent);
  ctx.setState("HasC", 1, true, EffectType.PlanOnly);
  const stackDepth = ctx.getWorldStateChangeDepth();

  ctx.setState("HasA", 1, false, EffectType.PlanAndExecute);
  ctx.setState("HasB", 1, false, EffectType.Permanent);
  ctx.setState("HasC", 1, false, EffectType.PlanOnly);
  ctx.trimToStackDepth(stackDepth);

  const hasAChanges = TestUtil.getWorldStateChangeStack(ctx, "HasA");
  const hasBChanges = TestUtil.getWorldStateChangeStack(ctx, "HasB");
  const hasCChanges = TestUtil.getWorldStateChangeStack(ctx, "HasC");
  assert.equal(hasAChanges.length, 1);
  assert.equal(hasBChanges.length, 1);
  assert.equal(hasCChanges.length, 1);
});

test("Trim to stack depth throws exception on wrong context state", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.ContextState = ContextState.Executing;
  const stackDepth = ctx.getWorldStateChangeDepth();

  assert.throws(() =>
    ctx.trimToStackDepth(stackDepth)
  );
});

test.run();
