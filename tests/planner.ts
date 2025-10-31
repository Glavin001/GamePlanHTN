// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import { test } from "uvu";
import * as assert from "uvu/assert";
import ContextState from "../src/contextState";
import Effect from "../src/effect";
import EffectType from "../src/effectType";
import DomainBuilder from "../src/domainBuilder";
import Planner from "../src/planner";
import PrimitiveTask from "../src/Tasks/primitiveTask";
import TaskStatus from "../src/taskStatus";
import * as TestUtil from "./utils";


test("Get Plan returns instance at start ", () => {
  const planner = new Planner();
  const plan = planner.getPlan();

  assert.ok(plan, null);
  assert.equal(plan.length, 0);
});

test("Get current task returns null at start ", () => {
  const planner = new Planner();
  const task = planner.getCurrentTask();

  assert.equal(task, null);
});

test("Tick with null parameters throws error ", () => {
  const planner = new Planner();

  assert.throws(() => {
    planner.tick(null, null);
  });
});

test("Tick with null domain throws exception ", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const planner = new Planner();

  assert.throws(() => {
    planner.tick(null, ctx);
  });
});

test("Tick without initialized context throws exception ", () => {
  const ctx = TestUtil.getEmptyTestContext();
  const domain = TestUtil.getEmptyTestDomain();
  const planner = new Planner();

  assert.throws(() => {
    planner.tick(domain, ctx);
  });
});

test("Tick with empty domain expected behavior ", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const domain = TestUtil.getEmptyTestDomain();
  const planner = new Planner();

  planner.tick(domain, ctx);
});

test("Tick with primitive task without operator expected behavior ", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = new PrimitiveTask({ name: "Sub-task" });

  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);
  const currentTask = planner.getCurrentTask();

  assert.not(currentTask);
  assert.equal(planner.LastStatus, TaskStatus.Failure);
});

test("Planner aborts task when runtime condition fails", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  let callCount = 0;
  let aborted = false;
  const task2 = new PrimitiveTask({
    name: "Conditional",
    operator: () => TaskStatus.Success,
    abort: () => {
      aborted = true;
    },
  });

  task2.addCondition(() => {
    callCount += 1;
    return callCount === 1;
  });

  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(aborted);
  assert.equal(planner.LastStatus, TaskStatus.Failure);
});

test("Tick with operator with null function expected behavior ", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = new PrimitiveTask({ name: "Sub-task" });

  task2.setOperator(undefined);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);
  const currentTask = planner.getCurrentTask();

  assert.not(currentTask);
  assert.equal(planner.LastStatus, TaskStatus.Failure);
});

test("Tick with default success operator won't stack overflow expected behavior ", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  const domain = TestUtil.getEmptyTestDomain();

  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getSimplePrimitiveTask("Sub-task");

  task2.setOperator((_context) => TaskStatus.Success);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);
  const currentTask = planner.getCurrentTask();

  assert.not(currentTask);
  assert.equal(planner.LastStatus, TaskStatus.Success);
});


test("Tick with default continue operator expected behavior", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getSimplePrimitiveTask("Sub-task");

  task2.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);
  const currentTask = planner.getCurrentTask();

  assert.ok(currentTask);
  assert.equal(planner.LastStatus, TaskStatus.Continue);
});

test("Planner aborts task when executing condition fails", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  let aborted = false;
  const task2 = new PrimitiveTask({
    name: "Exec conditional",
    operator: () => TaskStatus.Continue,
    abort: () => {
      aborted = true;
    },
  });

  task2.addExecutingCondition({
    Name: "Fails",
    func: () => false,
  });

  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(aborted);
  assert.equal(planner.LastStatus, TaskStatus.Failure);
});

test("Planner aborts task when operator fails", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  let aborted = false;
  const task2 = new PrimitiveTask({
    name: "Fails",
    operator: () => TaskStatus.Failure,
    abort: () => {
      aborted = true;
    },
  });

  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(aborted);
  assert.equal(planner.LastStatus, TaskStatus.Failure);
});

test("On New Plan expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onNewPlan = (p) => {
    result = p.length === 1;
  };

  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getSimplePrimitiveTask("Sub-task");

  task2.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(result);
});


test("On Replace Plan expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onReplacePlan = (op, ct, p) => {
    result = op.length === 0 && ct !== null && p.length === 1;
  };

  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getEmptySelectorTask("Test2");
  const task3 = new PrimitiveTask({ name: "Sub-task1" }).addCondition((context) => context.Done === false);
  const task4 = new PrimitiveTask({ name: "Sub-task2" });

  task3.setOperator((_context) => TaskStatus.Continue);
  task4.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(domain.Root, task2);
  domain.add(task1, task3);
  domain.add(task2, task4);

  ctx.Done = true;
  planner.tick(domain, ctx);

  ctx.Done = false;
  ctx.IsDirty = true;
  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On New Task expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onNewTask = (t) => {
    result = t.Name === "Sub-task";
  };
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getSimplePrimitiveTask("Sub-task");

  task2.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On New Task Condition Failed expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onNewTaskConditionFailed = (t, _c) => {
    result = t.Name === "Sub-task1";
  };
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getEmptySelectorTask("Test2");
  const task3 = new PrimitiveTask({ name: "Sub-task1" }).addCondition((context) => context.Done === false);
  const task4 = new PrimitiveTask({ Nname: "Sub-task2" });

  task3.setOperator((_context) => TaskStatus.Success);
  // Note that one should not use AddEffect on types that's not part of WorldState unless you
  // know what you're doing. Outside of the WorldState, we don't get automatic trimming of
  // state change. This method is used here only to invoke the desired callback, not because
  // its correct practice.

  task3.addEffect(new Effect({
    name: "TestEffect",
    type: EffectType.PlanAndExecute,
    action: (context, _type) => {
      context.Done = true;
    },
  }));

  task4.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(domain.Root, task2);
  domain.add(task1, task3);
  domain.add(task2, task4);

  ctx.Done = true;
  planner.tick(domain, ctx);

  ctx.Done = false;
  ctx.IsDirty = true;
  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On Stop Current Task expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();

  const planner = new Planner();

  planner.onStopCurrentTask = (t) => {
    result = t.Name === "Sub-task2";
  };
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getEmptySelectorTask("Test2");
  const task3 = new PrimitiveTask({ name: "Sub-task1" })
    .addCondition((context) => context.Done === false);
  const task4 = new PrimitiveTask({ name: "Sub-task2" });

  task3.setOperator((_context) => TaskStatus.Continue);
  task4.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(domain.Root, task2);
  domain.add(task1, task3);
  domain.add(task2, task4);

  ctx.Done = true;
  planner.tick(domain, ctx);

  ctx.Done = false;
  ctx.IsDirty = true;
  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On Current Task Completed Successfully expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onCurrentTaskCompletedSuccessfully = (t) => {
    result = t.Name === "Sub-task1";
  };

  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getEmptySelectorTask("Test2");
  const task3 = new PrimitiveTask({ name: "Sub-task1" })
    .addCondition((context) => context.Done === false);
  const task4 = new PrimitiveTask({ name: "Sub-task2" });

  task3.setOperator((_context) => TaskStatus.Success);
  task4.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(domain.Root, task2);
  domain.add(task1, task3);
  domain.add(task2, task4);

  ctx.Done = true;
  planner.tick(domain, ctx);

  ctx.Done = false;
  ctx.IsDirty = true;
  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On Apply Effec expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onApplyEffect = (e) => {
    result = e.Name === "TestEffect";
  };

  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = TestUtil.getEmptySelectorTask("Test2");
  const task3 = new PrimitiveTask({ name: "Sub-task1" })
    .addCondition((context) => !context.hasState("HasA"));
  const task4 = new PrimitiveTask({ name: "Sub-task2" });

  task3.setOperator((_context) => TaskStatus.Success);
  task3.addEffect(new Effect({
    name: "TestEffect",
    type: EffectType.PlanAndExecute,
    action: (context, type) => context.setState("HasA", 1, true, type),
  }));
  task4.setOperator((_context) => TaskStatus.Continue);

  domain.add(domain.Root, task1);
  domain.add(domain.Root, task2);
  domain.add(task1, task3);
  domain.add(task2, task4);

  ctx.ContextState = ContextState.Executing;
  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);

  ctx.ContextState = ContextState.Executing;
  ctx.setState("HasA", 0, true, EffectType.Permanent);
  planner.tick(domain, ctx);

  assert.ok(result);
});


test("On Current Task Failed expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onCurrentTaskFailed = (t) => {
    result = t.Name === "Sub-task";
  };
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = new PrimitiveTask({ name: "Sub-task" });

  task2.setOperator((_context) => TaskStatus.Failure);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On Current Task Continues expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onCurrentTaskContinues = (t) => {
    result = t.Name === "Sub-task";
  };
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = new PrimitiveTask({ name: "Sub-task" });

  task2.setOperator((_context) => TaskStatus.Continue);
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(result);
});

test("On Current Task Executing Condition Failed expected behavior ", () => {
  let result = false;
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();

  planner.onCurrentTaskExecutingConditionFailed = (t, c) => {
    result = t.Name === "Sub-task" && c.Name === "TestCondition";
  };
  const domain = TestUtil.getEmptyTestDomain();
  const task1 = TestUtil.getEmptySelectorTask("Test");
  const task2 = new PrimitiveTask({ name: "Sub-task" });

  task2.setOperator((_context) => TaskStatus.Continue);
  task2.addExecutingCondition({
    Name: "TestCondition",
    func: (context) => context.Done,
  });
  domain.add(domain.Root, task1);
  domain.add(task1, task2);

  planner.tick(domain, ctx);

  assert.ok(result);
});

test("Planner replans when condition change invalidates current task", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const select = TestUtil.getEmptySelectorTask("Test Select");

  const actionA = new PrimitiveTask({ name: "Test Action A" });
  actionA.addCondition((context) => context.Done === true);
  actionA.addExecutingCondition({ Name: "Can choose A", func: (context) => context.Done === true });
  actionA.setOperator(() => TaskStatus.Continue);

  const actionB = new PrimitiveTask({ name: "Test Action B" });
  actionB.addCondition((context) => context.Done === false);
  actionB.addExecutingCondition({ Name: "Can not choose A", func: (context) => context.Done === false });
  actionB.setOperator(() => TaskStatus.Continue);

  domain.add(domain.Root, select);
  domain.add(select, actionA);
  domain.add(select, actionB);

  planner.tick(domain, ctx, false);

  let plan = planner.getPlan();
  let currentTask = planner.getCurrentTask();
  assert.is(plan.length, 0);
  assert.is(currentTask?.Name, "Test Action B");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], 0);
  assert.is(ctx.MethodTraversalRecord[1], 1);

  ctx.Done = true;
  ctx.IsDirty = true;

  planner.tick(domain, ctx, true);

  plan = planner.getPlan();
  currentTask = planner.getCurrentTask();
  assert.is(plan.length, 0);
  assert.is(currentTask?.Name, "Test Action A");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], 0);
  assert.is(ctx.MethodTraversalRecord[1], 0);
});

test("Planner replans when world state change produces better plan", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const select = TestUtil.getEmptySelectorTask("Test Select");

  const actionA = new PrimitiveTask({ name: "Test Action A" });
  actionA.addCondition((context) => context.getState("HasA") === 1);
  actionA.setOperator(() => TaskStatus.Continue);

  const actionB = new PrimitiveTask({ name: "Test Action B" });
  actionB.addCondition((context) => context.getState("HasA") === 0);
  actionB.setOperator(() => TaskStatus.Continue);

  domain.add(domain.Root, select);
  domain.add(select, actionA);
  domain.add(select, actionB);

  planner.tick(domain, ctx, false);

  let plan = planner.getPlan();
  let currentTask = planner.getCurrentTask();
  assert.is(plan.length, 0);
  assert.is(currentTask?.Name, "Test Action B");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], 0);
  assert.is(ctx.MethodTraversalRecord[1], 1);

  ctx.setState("HasA", 1, true, EffectType.Permanent);

  planner.tick(domain, ctx, true);

  plan = planner.getPlan();
  currentTask = planner.getCurrentTask();
  assert.is(plan.length, 0);
  assert.is(currentTask?.Name, "Test Action A");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], 0);
  assert.is(ctx.MethodTraversalRecord[1], 0);
});

test("Planner replans when executing condition becomes invalid", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = TestUtil.getEmptyTestDomain();
  const select = TestUtil.getEmptySelectorTask("Test Select");

  const actionA = new PrimitiveTask({ name: "Test Action A" });
  actionA.addCondition((context) => context.getState("HasA") === 0);
  actionA.addExecutingCondition({ Name: "Can choose A", func: (context) => context.getState("HasA") === 0 });
  actionA.setOperator(() => TaskStatus.Continue);

  const actionB = new PrimitiveTask({ name: "Test Action B" });
  actionB.addCondition((context) => context.getState("HasA") === 1);
  actionB.addExecutingCondition({ Name: "Can not choose A", func: (context) => context.getState("HasA") === 1 });
  actionB.setOperator(() => TaskStatus.Continue);

  domain.add(domain.Root, select);
  domain.add(select, actionA);
  domain.add(select, actionB);

  planner.tick(domain, ctx, false);

  let plan = planner.getPlan();
  let currentTask = planner.getCurrentTask();
  assert.is(plan.length, 0);
  assert.is(currentTask?.Name, "Test Action A");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], 0);
  assert.is(ctx.MethodTraversalRecord[1], 0);

  ctx.setState("HasA", 1, true, EffectType.Permanent);

  planner.tick(domain, ctx, true);

  plan = planner.getPlan();
  currentTask = planner.getCurrentTask();
  assert.is(plan.length, 0);
  assert.is(currentTask?.Name, "Test Action B");
  assert.is(ctx.MethodTraversalRecord.length, 2);
  assert.is(ctx.MethodTraversalRecord[0], 0);
  assert.is(ctx.MethodTraversalRecord[1], 1);
});

test("Planner toggles plans when executing conditions track world state", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = new DomainBuilder("Test")
    .action("A")
    .condition("Is True", (context) => context.hasState("HasA"))
    .executingCondition("Is True", (context) => context.hasState("HasA"))
    .do((context) => {
      context.Done = true;
      return TaskStatus.Continue;
    })
    .end()
    .action("B")
    .condition("Is False", (context) => context.hasState("HasA") === false)
    .executingCondition("Is False", (context) => context.hasState("HasA") === false)
    .do((context) => {
      context.Done = false;
      return TaskStatus.Continue;
    })
    .end()
    .build();

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);

  ctx.setState("HasA", 0, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, false);

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);
});

test("Planner keeps current plan without executing conditions", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = new DomainBuilder("Test")
    .action("A")
    .condition("Is True", (context) => context.hasState("HasA"))
    .do((context) => {
      context.Done = true;
      return TaskStatus.Continue;
    })
    .end()
    .action("B")
    .condition("Is False", (context) => context.hasState("HasA") === false)
    .do((context) => {
      context.Done = false;
      return TaskStatus.Continue;
    })
    .end()
    .build();

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);

  ctx.setState("HasA", 0, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);
});

test("Planner can toggle plans when operator succeeds on invalid condition", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = new DomainBuilder("Test")
    .action("A")
    .condition("Is True", (context) => context.hasState("HasA"))
    .do((context) => {
      if (context.hasState("HasA") === false) {
        return TaskStatus.Success;
      }

      context.Done = true;
      return TaskStatus.Continue;
    })
    .end()
    .action("B")
    .condition("Is False", (context) => context.hasState("HasA") === false)
    .do((context) => {
      if (context.hasState("HasA")) {
        return TaskStatus.Success;
      }

      context.Done = false;
      return TaskStatus.Continue;
    })
    .end()
    .build();

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);

  ctx.setState("HasA", 0, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, false);

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);
});

test("Planner fails to toggle when operator returns failure on invalid condition", () => {
  const ctx = TestUtil.getEmptyTestContext();

  ctx.init();
  const planner = new Planner();
  const domain = new DomainBuilder("Test")
    .action("A")
    .condition("Is True", (context) => context.hasState("HasA"))
    .do((context) => {
      if (context.hasState("HasA") === false) {
        return TaskStatus.Failure;
      }

      context.Done = true;
      return TaskStatus.Continue;
    })
    .end()
    .action("B")
    .condition("Is False", (context) => context.hasState("HasA") === false)
    .do((context) => {
      if (context.hasState("HasA")) {
        return TaskStatus.Failure;
      }

      context.Done = false;
      return TaskStatus.Continue;
    })
    .end()
    .build();

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);

  ctx.setState("HasA", 0, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, false);

  ctx.setState("HasA", 1, true, EffectType.Permanent);
  planner.tick(domain, ctx);
  assert.is(ctx.Done, true);
});

test.run();
