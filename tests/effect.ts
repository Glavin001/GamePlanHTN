import { test } from "uvu";
import * as assert from "uvu/assert";

import Effect, { type EffectAction } from "../src/effect";
import EffectType from "../src/effectType";
import * as TestUtil from "./utils";

test("Create simple effect", () => {
  const effectFunction = (context) => {
    context.setState("Done", true, false);
  };
  const testEffect = new Effect(effectFunction);

  assert.ok(testEffect);
  assert.equal(testEffect.Name, "Unnamed Effect");
  assert.not(testEffect.Type);
  assert.equal(testEffect._effectFunction, effectFunction);
});

test("Create simple effect with props", () => {
  const effectFunction = (context) => {
    context.setState("Done", true, false);
  };
  const type = EffectType.PlanAndExecute;
  const name = "Test Effect";
  const testEffect = new Effect({
    action: effectFunction,
    type,
    name,
  });

  assert.ok(testEffect);
  assert.equal(testEffect.Name, name);
  assert.equal(testEffect.Type, type);
  assert.equal(testEffect._effectFunction, effectFunction);
});

test("Simple effect can mutate context", () => {
  const testContext = TestUtil.getEmptyTestContext();
  const effectFunction = (context) => {
    context.setState("Done", true, false);
  };
  const testEffect = new Effect(effectFunction);

  testEffect.apply(testContext);

  assert.ok(testEffect);
  assert.equal(testEffect.Name, "Unnamed Effect");
  assert.not(testEffect.Type);
  assert.equal(testEffect._effectFunction, effectFunction);
  assert.equal(testContext.hasState("Done"), true);
});

test("Props Effect can mutate context", () => {
  const testContext = TestUtil.getEmptyTestContext();
  const effectFunction = (context) => {
    context.setState("Done", true, false);
  };
  const type = EffectType.PlanAndExecute;
  const name = "Test Effect";
  const testEffect = new Effect({
    action: effectFunction,
    type,
    name,
  });

  testEffect.apply(testContext);


  assert.ok(testEffect);
  assert.equal(testEffect.Name, name);
  assert.equal(testEffect.Type, type);
  assert.equal(testEffect._effectFunction, effectFunction);
  assert.equal(testContext.hasState("Done"), true);
});

test("Effect with incorrect type for action doesn't crash", () => {
  const testContext = TestUtil.getEmptyTestContext();
  const effectFunction = "test" as unknown as EffectAction;

  const type = EffectType.PlanAndExecute;
  const name = "Test Effect";
  const testEffect = new Effect({
    action: effectFunction,
    type,
    name,
  });

  testEffect.apply(testContext);

  assert.ok(testEffect);
  assert.equal(testEffect.Name, name);
  assert.equal(testEffect.Type, type);
  assert.equal(testEffect._effectFunction, effectFunction);
  assert.not(testContext.hasState("Done"));
});

test("Effect apply throws when context is invalid", () => {
  const testEffect = new Effect({
    name: "Invalid",
    type: EffectType.PlanOnly,
    action: () => undefined,
  });

  assert.throws(() => {
    testEffect.apply(null);
  });
});

test.run();
