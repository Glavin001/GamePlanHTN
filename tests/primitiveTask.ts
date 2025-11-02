import { test } from "uvu";
import log from "loglevel";
import * as assert from "uvu/assert";

import PrimitiveTask from "../src/Tasks/primitiveTask";
import Context from "../src/context";
import Effect from "../src/effect";
import EffectType from "../src/effectType";
import TaskStatus from "../src/taskStatus";
import FuncCondition from "../src/conditions/funcCondition";
import FuncOperator from "../src/operators/funcOperator";

function getTestContext() {
  return new Context<{ HasA: number; HasB: number; HasC: number; Done: boolean }>({
    HasA: 0,
    HasB: 0,
    HasC: 0,
    Done: false,
  });
}

const prim = {
  name: "foo",
  conditions: [],
  effects: [],
  operator: () => {
    log.info("test");
    return TaskStatus.Success;
  },
};

const prim2 = () => {
  log.info("primitive 2");
};

test("Create simple primitive task", () => {
  const task = new PrimitiveTask(prim);

  assert.is(task.Name, "foo");
  assert.type(task.operator, "function");
});

test("AddCondition returns task and stores condition", () => {
  const task = new PrimitiveTask({ name: "Test" });
  const result = task.addCondition(() => true);

  assert.is(result, task);
  assert.is(task.Conditions.length, 1);
});

test("AddCondition accepts FuncCondition", () => {
  const task = new PrimitiveTask({ name: "Test" });
  const condition = new FuncCondition("Check", (context) => context.IsInitialized === false);
  const context = new Context();
  context.init();

  task.addCondition(condition);

  assert.is(task.Conditions.length, 1);
  assert.is(task.isValid(context), false);
});

test("AddExecutingCondition returns task and stores condition", () => {
  const task = new PrimitiveTask({ name: "Test" });
  const result = task.addExecutingCondition({ Name: "Check", func: () => true });

  assert.is(result, task);
  assert.is(task.ExecutingConditions.length, 1);
  assert.is(task.ExecutingConditions[0].Name, "Check");
});

test("AddExecutingCondition accepts FuncCondition", () => {
  const task = new PrimitiveTask({ name: "Test" });
  const condition = new FuncCondition("Check", () => true);

  task.addExecutingCondition(condition);

  assert.is(task.ExecutingConditions.length, 1);
  assert.is(task.ExecutingConditions[0].Name, "Check");
});

test("AddEffect wraps definition and returns task", () => {
  const task = new PrimitiveTask({ name: "Test" });
  const result = task.addEffect({
    name: "Apply",
    type: EffectType.PlanOnly,
    action: (context) => {
      context.setState("Done", true, false);
    },
  });

  assert.is(result, task);
  assert.is(task.Effects.length, 1);
  const context = new Context<{ Done: boolean }>({ Done: false });
  context.init();
  task.applyEffects(context);
  assert.ok(context.hasState("Done"));
});

test("Create simple functional primitive task ", () => {
  const task = new PrimitiveTask(prim2);

  assert.is(task.Name, "");
  assert.type(task.operator, "function");
});


test("Create simple anonymous primitive task ", () => {
  const task = new PrimitiveTask(() => {
    log.info("three");
  });

  assert.is(task.Name, "");
  assert.type(task.operator, "function");
});

test("Set operator stores function and returns task", () => {
  const task = new PrimitiveTask({ name: "Test" });
  const operator = () => TaskStatus.Success;
  const result = task.setOperator(operator);

  assert.is(result, task);
  assert.is(task.operator, operator);
});

test("Set operator throws when called twice with different function", () => {
  const task = new PrimitiveTask({ name: "Test" });
  task.setOperator(() => TaskStatus.Success);

  assert.throws(() => {
    task.setOperator(() => TaskStatus.Failure);
  });
});

const primPrecon1 = {
  name: "Precondition Fail",
  conditions: [
    () => false,
  ],
  effects: [],
  operator: () => {
    log.info("test");
    return TaskStatus.Success;
  },
};

test("Test a failed precondition (uninitialized context)", () => {
  const task = new PrimitiveTask(primPrecon1);

  assert.is(task.isValid(new Context()), false);
});

const primPrecon2 = {
  name: "Precondition Pass",
  conditions: [
    () => true,
  ],
  effects: [],
  operator: () => {
    log.info("test");
    return TaskStatus.Success;
  },
};

test("Test a passed precondition ", () => {
  const task = new PrimitiveTask(primPrecon2);
  const context = new Context();

  context.init();
  assert.is(task.isValid(context), true);
});

test("Test a conditions that aren't functions are invalid ", () => {
  const task = new PrimitiveTask(primPrecon2);

  task.Conditions.push("Spaghetti" as unknown as (context: Context) => boolean);

  const context = new Context();

  context.init();
  assert.not(task.isValid(context));
});

test("Test a conditions that return false invalidate ", () => {
  const task = new PrimitiveTask(primPrecon2);

  task.Conditions.push(() => false);

  const context = new Context();

  context.init();
  assert.not(task.isValid(context));
});

test("Applying effects, expected behavior ", () => {
  const ctx = getTestContext();
  const task = new PrimitiveTask(primPrecon2);

  task.Effects.push(new Effect((context) => {
    context.setState("Done", true, false);
  }));

  task.applyEffects(ctx);

  assert.ok(ctx.hasState("Done"));
});

test("Stop and abort handlers trigger when configured", () => {
  const context = new Context();
  context.init();
  const stopped: Context[] = [];
  const aborted: Context[] = [];
  const task = new PrimitiveTask({ name: "Handlers" });

  task.setOperator(
    () => TaskStatus.Success,
    (ctx) => {
      stopped.push(ctx);
    },
    (ctx) => {
      aborted.push(ctx);
    },
  );

  task.stop(context);
  task.abort(context);

  assert.is(stopped.length, 1);
  assert.is(aborted.length, 1);
});

test("Stop throws for invalid context", () => {
  const task = new PrimitiveTask({ name: "Handlers" });

  assert.throws(() => {
    task.stop(null as unknown as Context);
  });
});

test("Abort handler from config is invoked", () => {
  const context = new Context();
  context.init();
  let aborted = false;
  const task = new PrimitiveTask({
    name: "Configured",
    operator: () => TaskStatus.Success,
    abort: () => {
      aborted = true;
    },
  });

  task.abort(context);

  assert.ok(aborted);
});

test("Stop with null operator is a no-op", () => {
  const context = new Context<{ Done: boolean }>({ Done: false });
  context.init();
  const task = new PrimitiveTask({ name: "No operator" });

  task.stop(context);
  task.abort(context);

  assert.is(context.hasState("Done", false), true);
});

test("Set operator accepts FuncOperator", () => {
  const context = new Context();
  context.init();
  const task = new PrimitiveTask({ name: "Test" });
  const stopped: Context[] = [];
  const aborted: Context[] = [];
  const operator = new FuncOperator(
    () => TaskStatus.Success,
    (ctx) => stopped.push(ctx),
    (ctx) => aborted.push(ctx),
  );

  task.setOperator(operator);

  assert.type(task.operator, "function");
  const status = task.operator?.(context);
  assert.is(status, TaskStatus.Success);
  task.stop(context);
  task.abort(context);
  assert.is(stopped.length, 1);
  assert.is(aborted.length, 1);
});

test.run();
