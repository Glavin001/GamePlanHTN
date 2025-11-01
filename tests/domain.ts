
import { test } from "uvu";
import * as assert from "uvu/assert";
import log from "loglevel";
import Domain, { type DomainOptions } from "../src/domain";
import TaskStatus from "../src/taskStatus";
import DecompositionStatus from "../src/decompositionStatus";
import * as TestUtil from "./utils";
import ContextState from "../src/contextState";
import EffectType from "../src/effectType";
import PausePlanTask from "../src/Tasks/pausePlanTask";
import FuncCondition from "../src/conditions/funcCondition";
import type { TestContext } from "./utils";

log.enableAll();

const example1: DomainOptions<TestContext> = {
  name: "Test",
  tasks: [
    {
      name: "GetC",
      type: "select",
      tasks: [
        {
          name: "Get C (Primitive Task)",
          conditions: [
            // Has A and B
            (context) => context.hasState("HasA") && context.hasState("HasB"),
            // Has NOT C
            (context) => !context.hasState("HasC"),
          ],
          operator: (_context) => {
            log.info("Get C");

            return TaskStatus.Success;
          },
          effects: [
            // Has C
            (context) => context.setState("HasC"),
          ],
        },
      ],
    },
    {
      name: "GatAandB",
      type: "sequence",
      tasks: [
        {
          name: "Get A (Primitive Task)",
          conditions: [
            // Has NOT A NOR B
            (context) => !(context.hasState("HasA") && context.hasState("HasB")),
          ],
          operator:
            // Get A
            (_context) => {
              log.info("Get A");

              return TaskStatus.Success;
            },
          effects: [
            // Has A
            (context) => context.setState("HasA"),
          ],
        }, {
          name: "Get B (Primitive Task)",
          operator:
            // Get A
            (_context) => {
              log.info("Get B");

              return TaskStatus.Success;
            },
          effects: [
            // Has B
            (context) => context.setState("HasB"),
          ],
        },
      ],
    },
    {
      name: "Done",
      type: "select",
      tasks: [
        {
          name: "Done",
          operator: () => {
            log.info("Done");

            return TaskStatus.Continue;
          },
        },
      ],
    },
  ],
};

// This style is planned but not supported yet
/*
let example2 = {
  name: "Get A, B, then C",
  tasks: [
    {
      name: "GetC",
      type: "select",
      tasks: [
        {
          conditions: ["hasAandB", "hasNotC"],
          actions: ["getC"],
          effects: ["hasC"],
        },
      ],
    },
    {
      name: "GetAandB",
      type: "sequence",
      tasks: [
        {
          conditions: ["hasNotANorB"],
          actions: ["getA"],
          effects: ["hasA"],
        }, {
          actions: ["getA"],
          effects: ["hasB"],
        },
      ],
    }, {
      name: "Done",
      type: "sequence",
      tasks: [
        {
          name: "Done",
          actions: ["done"],
        },
      ],
    },
  ],
  actions: {
    done: (context) => {
      console.log("Done");

      return TaskStatus.Continue;
    },
    // Get A
    getA: () => {
      console.log("Get A");
      return TaskStatus.Success;
    },
    // Get B
    getB:
      () => {
        console.log("Get B");
        return TaskStatus.Success;
      },
    // Get C
    getC:
      () => {
        console.log("Get C");
        return TaskStatus.Success;
      },
  },
  conditions: {
    // Has NOT A NOR B
    hasNotANorB: (context) => !(context.hasState("HasA") && context.hasState("HasB")),
    // Has A and B
    hasAandB: (context) => context.hasState("HasA") && context.hasState("HasB"),
    // Has NOT C
    hasNotC: (context) => !context.hasState("HasC"),
  },
  effects: {
    hasA: (context) => context.setState("HasA"),
    hasB: (context) => context.setState("HasB"),
    hasC: (context) => context.setState("HasC"),
  },
};
*/


test("Create a Domain successfully", () => {
  new Domain<TestContext>(example1);
});

test("Name and Root are added to domains", () => {
  const domain = new Domain<TestContext>(example1);

  assert.ok(domain.Root);
  assert.equal(domain.Name, "Test");
});

test("Add Subtask to domain expected behavior", () => {
  const domain = new Domain<TestContext>({});

  const task1 = TestUtil.getEmptyCompoundTask<TestContext>();
  const task2 = TestUtil.getSimplePrimitiveTask<TestContext>("foo");

  domain.add(task1, task2);
  assert.ok(task1.Children.includes(task2));
  assert.equal(task2.Parent, task1);
});

test("Planning throws without a context", () => {
  const domain = new Domain<TestContext>({});

  assert.throws(() => {
    domain.findPlan(null);
  });
});

test("Planning throws with an uninitialized context", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const domain = new Domain<TestContext>({});

  assert.throws(() => {
    domain.findPlan(ctx);
  });
});


test("Planning returns null if there are no tasks", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const domain = new Domain<TestContext>({ name: "Test" });
  const planResult = domain.findPlan(ctx);

  assert.equal(planResult.status, DecompositionStatus.Rejected);
  assert.equal(planResult.plan.length, 0);
});

test("MTR Null throws exception", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.MethodTraversalRecord = null;

  const domain = new Domain<TestContext>({ name: "Test" });

  assert.throws(() => {
    domain.findPlan(ctx);
  });
});

test("Planning leaves context in Executing state", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const domain = TestUtil.getEmptyTestDomain<TestContext>();

  domain.findPlan(ctx);
  assert.equal(ctx.ContextState, ContextState.Executing);
});

test("findPlan expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const task1 = TestUtil.getEmptySelectorTask<TestContext>("Test");
  const task2 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task");

  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  const planResult = domain.findPlan(ctx);

  assert.equal(planResult.status, DecompositionStatus.Succeeded);
  assert.ok(planResult.plan);
  assert.equal(planResult.plan.length, 1);
  assert.equal(planResult.plan[0].Name, "Sub-task");
});

test("findPlan trims non permanent state changes", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const task1 = TestUtil.getEmptySequenceTask<TestContext>("Test");
  const task2 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1");

  task2.Effects.push(TestUtil.getSimpleEffect("TestEffect1",
    EffectType.PlanOnly,
    "HasA"));

  const task3 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2");

  task3.Effects.push(TestUtil.getSimpleEffect("TestEffect2",
    EffectType.PlanAndExecute,
    "HasB"));

  const task4 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3");

  task4.Effects.push(TestUtil.getSimpleEffect("TestEffect3",
    EffectType.Permanent,
    "HasC"));

  domain.add(domain.Root, task1);
  domain.add(task1, task2);
  domain.add(task1, task3);
  domain.add(task1, task4);

  const planResult = domain.findPlan(ctx);

  assert.equal(planResult.status, DecompositionStatus.Succeeded);
  assert.equal(ctx.WorldStateChangeStack.HasA.length, 0);
  assert.equal(ctx.WorldStateChangeStack.HasB.length, 0);
  assert.equal(ctx.WorldStateChangeStack.HasC.length, 0);
  assert.equal(ctx.WorldState.HasA, 0);
  assert.equal(ctx.WorldState.HasB, 0);
  assert.equal(ctx.WorldState.HasC, 1);
  assert.equal(planResult.plan.length, 3);
});


test("findPlan clears state change when plan is empty", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const domain = TestUtil.getEmptyTestDomain<typeof ctx>();
  const task1 = TestUtil.getEmptySequenceTask<TestContext>("Test");
  const task2 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1");
  const task3 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2");
  const task4 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3");
  const task5 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task4");

  task2.Effects.push(TestUtil.getSimpleEffect("TestEffect1", EffectType.PlanOnly, "HasA"));
  task3.Effects.push(TestUtil.getSimpleEffect("TestEffect2", EffectType.PlanAndExecute, "HasB"));
  task4.Effects.push(TestUtil.getSimpleEffect("TestEffect3", EffectType.Permanent, "HasC"));

  task5.Conditions.push((context) => context.hasState("Done"));

  domain.add(domain.Root, task1);
  domain.add(task1, task2);
  domain.add(task1, task3);
  domain.add(task1, task4);
  domain.add(task1, task5);

  const status = domain.findPlan(ctx);

  assert.equal(status.status, DecompositionStatus.Rejected);
  assert.equal(ctx.WorldStateChangeStack.HasA.length, 0);
  assert.equal(ctx.WorldStateChangeStack.HasB.length, 0);
  assert.equal(ctx.WorldStateChangeStack.HasC.length, 0);
  assert.equal(ctx.WorldState.HasA, 0);
  assert.equal(ctx.WorldState.HasB, 0);
  assert.equal(ctx.WorldState.HasC, 0);
  assert.equal(status.plan, []);
});


test("findPlan if MTRs are equal then return empty plan", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.LastMTR.push(1);
  ctx.LastMTR.push(0);

  // Root is a Selector that branches into task1 sequence or task2 selector.
  // With selectors tracking both compound nodes and the winning primitive child,
  // the recorded MTR has two entries when a plan is found.
  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const task1 = TestUtil.getEmptySequenceTask<TestContext>("Test1");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");
  const task3 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1").addCondition((context) => context.hasState("Done"));
  const task4 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1");
  const task5 = TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2").addCondition((context) => context.hasState("Done"));

  domain.add(domain.Root, task1);
  domain.add(domain.Root, task2);
  domain.add(task1, task3);
  domain.add(task2, task4);
  domain.add(task2, task5);
  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Rejected);
  assert.equal(plan.length, 0);
  assert.equal(ctx.MethodTraversalRecord.length, 2);
  assert.equal(ctx.MethodTraversalRecord[0], ctx.LastMTR[0]);
  assert.equal(ctx.MethodTraversalRecord[1], ctx.LastMTR[1]);
});

test("findPlan selects better primary task when MTR improves", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  ctx.LastMTR.push(0);
  ctx.LastMTR.push(1);

  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const selector = TestUtil.getEmptySelectorTask<TestContext>("Select");
  const actionA = TestUtil.getSimplePrimitiveTask<TestContext>("Action A")
    .addCondition(new FuncCondition("Can choose A", (context) => context.hasState("Done")));
  const actionB = TestUtil.getSimplePrimitiveTask<TestContext>("Action B")
    .addCondition(new FuncCondition("Can choose B", (context) => !context.hasState("Done")));

  domain.add(domain.Root, selector);
  domain.add(selector, actionA);
  domain.add(selector, actionB);

  let { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Rejected);
  assert.is(plan.length, 0);
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], ctx.LastMTR[0]);
  assert.is(ctx.MethodTraversalRecord[1], ctx.LastMTR[1]);

  ctx.setState("Done", true, false);
  ctx.IsDirty = true;

  ({ status, plan } = domain.findPlan(ctx));

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.is(plan.length, 1);
  assert.is(plan[0].Name, "Action A");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], ctx.LastMTR[0]);
  assert.ok(ctx.MethodTraversalRecord[1] < ctx.LastMTR[1]);
});


test("Pause Plan expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const task = TestUtil.getEmptySequenceTask<TestContext>("Test");

  domain.add(domain.Root, task);
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1"));
  domain.add(task, new PausePlanTask());
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Partial);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task1", plan[0].Name);
  assert.equal(ctx.HasPausedPartialPlan, true);
  assert.equal(ctx.PartialPlanQueue.length, 1);
  assert.equal(task, ctx.PartialPlanQueue[0].task);
  assert.equal(2, ctx.PartialPlanQueue[0].taskIndex);
});

test("Continue Paused Plan expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const task = TestUtil.getEmptySequenceTask<TestContext>("Test");

  domain.add(domain.Root, task);
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1"));
  domain.add(task, new PausePlanTask());
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  let { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Partial);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task1", plan.shift().Name);
  assert.equal(ctx.HasPausedPartialPlan, true);
  assert.equal(ctx.PartialPlanQueue.length, 1);
  assert.equal(task, ctx.PartialPlanQueue[0].task);
  assert.equal(2, ctx.PartialPlanQueue[0].taskIndex);

  ({ status, plan } = domain.findPlan(ctx));

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task2", plan[0].Name);
});

test("Nested Pause Plan Expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const domain = TestUtil.getEmptyTestDomain<TestContext>();
  const task = TestUtil.getEmptySequenceTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");
  const task3 = TestUtil.getEmptySequenceTask<TestContext>("Test3");

  domain.add(domain.Root, task);
  domain.add(task, task2);
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task4"));

  domain.add(task2, task3);
  domain.add(task2, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  domain.add(task3, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1"));
  domain.add(task3, new PausePlanTask());
  domain.add(task3, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Partial);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task1", plan[0].Name);
  assert.equal(ctx.HasPausedPartialPlan, true);
  assert.equal(ctx.PartialPlanQueue.length, 2);
  const queueAsArray = ctx.PartialPlanQueue;

  assert.equal(task3, queueAsArray[0].task);
  assert.equal(2, queueAsArray[0].taskIndex);
  assert.equal(task, queueAsArray[1].task);
  assert.equal(1, queueAsArray[1].taskIndex);
});


test("Continue nested pause plan expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const domain = TestUtil.getEmptyTestDomain();

  const task = TestUtil.getEmptySequenceTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");
  const task3 = TestUtil.getEmptySequenceTask<TestContext>("Test3");

  domain.add(domain.Root, task);
  domain.add(task, task2);
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task4"));

  domain.add(task2, task3);
  domain.add(task2, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  domain.add(task3, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1"));
  domain.add(task3, new PausePlanTask());
  domain.add(task3, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  let { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Partial);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task1", plan.shift().Name);
  assert.ok(ctx.HasPausedPartialPlan);
  assert.equal(ctx.PartialPlanQueue.length, 2);
  const queueAsArray = ctx.PartialPlanQueue;

  assert.equal(task3, queueAsArray[0].task);
  assert.equal(2, queueAsArray[0].taskIndex);
  assert.equal(task, queueAsArray[1].task);
  assert.equal(1, queueAsArray[1].taskIndex);

  ({ status, plan } = domain.findPlan(ctx));

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.equal("Sub-task2", plan.shift().Name);
  assert.equal("Sub-task4", plan.shift().Name);
});

test("Continue multiple nested pause plan expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const domain = TestUtil.getEmptyTestDomain();

  const task = TestUtil.getEmptySequenceTask<TestContext>("Test");
  const task2 = TestUtil.getEmptySelectorTask<TestContext>("Test2");
  const task3 = TestUtil.getEmptySequenceTask<TestContext>("Test3");
  const task4 = TestUtil.getEmptySequenceTask<TestContext>("Test4");

  domain.add(domain.Root, task);

  domain.add(task3, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task1"));
  domain.add(task3, new PausePlanTask());
  domain.add(task3, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task2"));

  domain.add(task2, task3);
  domain.add(task2, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task3"));

  domain.add(task4, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task5"));
  domain.add(task4, new PausePlanTask());
  domain.add(task4, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task6"));

  domain.add(task, task2);
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task4"));
  domain.add(task, task4);
  domain.add(task, TestUtil.getSimplePrimitiveTask<TestContext>("Sub-task7"));

  let { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Partial);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.equal("Sub-task1", plan.shift().Name);
  assert.ok(ctx.HasPausedPartialPlan);
  assert.equal(ctx.PartialPlanQueue.length, 2);
  const queueAsArray = ctx.PartialPlanQueue;

  assert.equal(task3, queueAsArray[0].task);
  assert.equal(2, queueAsArray[0].taskIndex);
  assert.equal(task, queueAsArray[1].task);
  assert.equal(1, queueAsArray[1].taskIndex);

  ({ status, plan } = domain.findPlan(ctx));

  assert.equal(status, DecompositionStatus.Partial);
  assert.ok(plan);
  assert.equal(plan.length, 3);
  assert.equal("Sub-task2", plan.shift().Name);
  assert.equal("Sub-task4", plan.shift().Name);
  assert.equal("Sub-task5", plan.shift().Name);

  ({ status, plan } = domain.findPlan(ctx));

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.equal("Sub-task6", plan.shift().Name);
  assert.equal("Sub-task7", plan.shift().Name);
});

test.run();
