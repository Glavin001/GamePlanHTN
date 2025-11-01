import { test } from "uvu";
import log from "loglevel";
import * as assert from "uvu/assert";

import CompoundTask from "../src/Tasks/compoundTask";
import TaskStatus from "../src/taskStatus";
import * as TestUtil from "./utils";
import type { TestContext } from "./utils";

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
  return TaskStatus.Success;
};

const compound = {
  name: "foo2",
  type: "sequence" as const,
  conditions: [],
  effects: [],
  tasks: [
    prim,
    () => {
      log.info("test");
      return TaskStatus.Success;
    },
    prim2,
  ],
};

test("Create a simple sequence of 3 primitive tasks", () => {
  const task = new CompoundTask<TestContext>(compound);

  assert.is(task.Name, "foo2");
  assert.is(task.Type, "sequence");
  assert.is(task.Children.length, 3);
  assert.is(task.Children[0].Name, "foo");
});

const compound2 = {
  name: "foo3",
  type: "sequence" as const,
  conditions: [],
  effects: [],
  tasks: [
    () => {
      log.info("test");
      return TaskStatus.Success;
    },
  ],
};

test("Create a compound task with only one anonymous primitive task", () => {
  const task = new CompoundTask<TestContext>(compound2);

  assert.is(task.Name, "foo3");
  assert.is(task.Type, "sequence");
  assert.is(task.Children.length, 1);
  assert.is(task.Children[0].Name, "");
});

const compound3 = {
  name: "Compound with conditions",
  type: "sequence" as const,
  conditions: [() => true],
  effects: [],
  tasks: [
    () => {
      log.info("test");
      return TaskStatus.Success;
    },
  ],
};

test("Create a compound task with one valid condition", () => {
  const task = new CompoundTask<TestContext>(compound3);
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  assert.is(task.Name, "Compound with conditions");
  assert.is(task.Type, "sequence");
  assert.is(task.Conditions.length, 1);
  assert.is(task.Children[0].Name, "");
  assert.is(task.isValid(ctx), true);
});

const compound4 = {
  name: "Compound with conditions",
  type: "select" as const,
  conditions: [() => true],
  effects: [],
  tasks: [
    () => {
      log.info("test");
      return TaskStatus.Success;
    },
  ],
};

test("Create a compound task with one valid condition", () => {
  const task = new CompoundTask<TestContext>(compound4);
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  assert.is(task.Name, "Compound with conditions");
  assert.is(task.Type, "select");
  assert.is(task.Conditions.length, 1);
  assert.is(task.Children[0].Name, "");
  assert.is(task.isValid(ctx), true);
});

test.run();
