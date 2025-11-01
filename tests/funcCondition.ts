import { test } from "uvu";
import * as assert from "uvu/assert";

import FuncCondition from "../src/conditions/funcCondition";
import Context from "../src/context";

test("FuncCondition stores name", () => {
  const condition = new FuncCondition("Named", () => true);

  assert.is(condition.Name, "Named");
});

test("FuncCondition without predicate returns false", () => {
  const context = new Context();
  context.init();
  const condition = new FuncCondition("Missing");

  assert.is(condition.isValid(context), false);
});

test("FuncCondition throws for invalid context", () => {
  const condition = new FuncCondition("Named", () => true);

  assert.throws(() => {
    condition.isValid(null);
  });
});

test("FuncCondition evaluates predicate", () => {
  const context = new Context();
  context.init();
  let called = false;
  const condition = new FuncCondition("Check", (ctx) => {
    called = true;
    return ctx.IsInitialized;
  });

  assert.is(condition.isValid(context), true);
  assert.ok(called);
});

test.run();
