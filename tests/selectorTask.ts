import { test } from "uvu";
import * as assert from "uvu/assert";
import DecompositionStatus from "../src/decompositionStatus";
import * as TestUtil from "./utils";
import type { TestContext } from "./utils";

test("Add condition expected behavior", () => {
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const t = task.addCondition((context) => context.hasState("Done", false));

  assert.equal(t, task);
  assert.equal(task.Conditions.length, 1);
});

test("Add subtask expected behavior", () => {
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const t = task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task"));

  assert.equal(t, task);
  assert.equal(task.Children.length, 1);
});

test("Is valid fails without subtasks expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  assert.equal(task.isValid(ctx), false);
});

test("Is valid expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task"));

  assert.equal(task.isValid(ctx), true);
});

test("Decompose with no subtasks expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const status = task.decompose(ctx, 0);

  assert.equal(status.status, DecompositionStatus.Failed);
  assert.ok(status.plan);
  assert.equal(status.plan.length, 0);
});

test("Decompose with subtasks expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1"));
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));
  const status = task.decompose(ctx, 0);

  assert.equal(status.status, DecompositionStatus.Succeeded);
  assert.ok(status.plan);
  assert.equal(status.plan.length, 1);
  assert.equal("Sub-task1", status.plan[0].Name);
});

test("Decompose with subtasks 2 expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  task.addSubtask(TestUtil.getEmptySelectorTask<TestContext>("Sub-task1"));
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));
  const status = task.decompose(ctx, 0);

  assert.equal(status.status, DecompositionStatus.Succeeded);
  assert.ok(status.plan);
  assert.equal(status.plan.length, 1);
  assert.equal("Sub-task2", status.plan[0].Name);
});


test("Decompose with subtasks 3 expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1").addCondition((context) => context.hasState("Done")));
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].Name, "Sub-task2",);
});


test("Decompose MTR Fails expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1").addCondition((context) => context.hasState("Done")));
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  ctx.LastMTR.push(0);
  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Rejected);
  assert.equal(plan.length, 0);
  assert.equal(ctx.MethodTraversalRecord.length, 1);
  assert.equal(ctx.MethodTraversalRecord[0], -1,);
});

test("DecomposeDebug MTR Fails expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  ctx.DebugMTR = true;
  ctx.init();

  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1").addCondition((context) => context.hasState("Done")));
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));
  ctx.LastMTR.push(0);

  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Rejected);
  assert.equal(plan.length, 0);
  assert.equal(ctx.MTRDebug.length, 1);
  assert.ok(ctx.MTRDebug[0].includes("REPLAN FAIL"));
  assert.ok(ctx.MTRDebug[0].includes("Sub-task2"));
});

test("Decompose MTR Succeeds when equal expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");

  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1").addCondition((context) => context.hasState("Done")));
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  ctx.LastMTR.push(1);
  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(ctx.MethodTraversalRecord.length, 1);
  assert.equal(ctx.MethodTraversalRecord[0], ctx.LastMTR[0]);
  assert.equal(plan.length, 1);
});


test("Decompose Compound Subtasks Succeeds expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");

  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1").addCondition((context) => context.hasState("Done")));
  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  task.addSubtask(task2);
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task2", plan[0].Name);
  assert.equal(ctx.MethodTraversalRecord.length, 2);
  assert.equal(ctx.MethodTraversalRecord[0], 0);
  assert.equal(ctx.MethodTraversalRecord[1], 1);
});

test("Decompose Compound Subtasks fails expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");

  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1"));
  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task2"));

  task.addSubtask(task2);
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task3", plan[0].Name);
  assert.equal(ctx.MethodTraversalRecord.length, 1);
  assert.equal(ctx.MethodTraversalRecord[0], 1);
});


test("Decompose Nested Compound Subtasks fails expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");
  const task3 = TestUtil.getEmptySelectorTask<TestContext>("Test3");

  task3.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1"));
  task3.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task2"));

  task2.addSubtask(task3);
  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task3"));


  task.addSubtask(task2);
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task4"));

  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task4", plan[0].Name);
  assert.equal(ctx.MethodTraversalRecord.length, 1);
  assert.equal(ctx.MethodTraversalRecord[0], 1);
});


test("Decompose Compound Subtasks beats last mtr expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");

  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1"));
  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  task.addSubtask(task2);
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  ctx.LastMTR.push(1);
  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].Name, "Sub-task2");
  assert.equal(ctx.MethodTraversalRecord.length, 2);
  assert.equal(ctx.MethodTraversalRecord[0], 0);
  assert.equal(ctx.MethodTraversalRecord[1], 1);
});


test("Decompose Compound Subtasks equal to last mtr expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");

  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1"));
  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  task.addSubtask(task2);
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  ctx.LastMTR.push(0);
  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].Name, "Sub-task2");
  assert.equal(ctx.MethodTraversalRecord.length, 2);
  assert.equal(ctx.MethodTraversalRecord[0], 0);
  assert.equal(ctx.MethodTraversalRecord[1], 1);
});


test("Decompose Compound Subtasks lose to last mtr expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");

  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1"));
  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  task.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1"));
  task.addSubtask(task2);

  ctx.LastMTR.push(0);
  const { status, plan } = task.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Rejected);
  assert.equal(plan.length, 0);
  assert.equal(ctx.MethodTraversalRecord.length, 1);
  assert.equal(ctx.MethodTraversalRecord[0], -1);
});


test("Decompose Compound Subtasks Win over Last mtr expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const rootTask = TestUtil.getEmptySelectorTask<TestContext>("Root");
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test1");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");
  const task3 = TestUtil.getEmptySelectorTask<TestContext>("Test3");

  task3.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task3-1"));
  task3.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3-2"));

  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task2-1"));
  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2-2"));

  task.addSubtask(task2);
  task.addSubtask(task3);
  task.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1-1").addCondition((context) => context.hasState("Done", false)));

  rootTask.addSubtask(task);

  ctx.LastMTR.push(0);
  ctx.LastMTR.push(1);
  ctx.LastMTR.push(0);

  // In this test, we prove that [0, 0, 1] beats [0, 1, 0]
  const { status } = rootTask.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Succeeded);
});


test("Decompose Compound Subtasks Lose to Last mtr expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const rootTask = TestUtil.getEmptySelectorTask<TestContext>("Root");
  const task = TestUtil.getEmptySelectorTask<TestContext>("Test1");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");

  task2.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task2-1"));
  task2.addSubtask(TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2-1"));

  task.addSubtask(TestUtil.getSimplePrimitiveTaskWithDoneCondition("Sub-task1-1"));
  task.addSubtask(task2);

  rootTask.addSubtask(task);

  ctx.LastMTR.push(0);
  ctx.LastMTR.push(1);
  ctx.LastMTR.push(0);

  // With duplicate children removed by name, the replanning attempt should fail without improvement
  const { status, plan } = rootTask.decompose(ctx, 0);

  assert.equal(status, DecompositionStatus.Failed);
  assert.equal(plan.length, 0);
  assert.equal(ctx.MethodTraversalRecord.length, 0);
});

test.run();
