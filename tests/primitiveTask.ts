// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import { test } from "uvu";
import log from "loglevel";
import * as assert from "uvu/assert";

import PrimitiveTask from "../src/Tasks/primitiveTask";
import Context from "../src/context";
import Effect from "../src/effect";
import TaskStatus from "../src/taskStatus";

function getTestContext() {
  const context = new Context();

  context.WorldState = {
    HasA: 0,
    HasB: 0,
    HasC: 0,
  };

  return context;
}

const prim = {
  name: "foo",
  conditions: [],
  effects: [],
  operator: () => {
    log.info("test");
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

const primPrecon1 = {
  name: "Precondition Fail",
  conditions: [
    () => false,
  ],
  effects: [],
  operator: () => {
    log.info("test");
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

  task.Conditions.push("Spaghetti");

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
    context.Done = true;
  }));

  task.applyEffects(ctx);

  assert.ok(ctx.Done);
});

test("Stop and abort handlers trigger when configured", () => {
  const context = new Context();
  context.init();
  const stopped: Context[] = [];
  const aborted: Context[] = [];
  const task = new PrimitiveTask({
    name: "Handlers",
    operator: () => TaskStatus.Success,
  });

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

test.run();
