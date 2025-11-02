import { performance } from "node:perf_hooks";
import { test } from "uvu";
import * as assert from "uvu/assert";
import Context from "../src/context";
import DomainBuilder from "../src/domainBuilder";
import DecompositionStatus from "../src/decompositionStatus";
import TaskStatus from "../src/taskStatus";
import { EffectType } from "../src/effectType";

const createTestContext = (): Context => {
  const ctx = new Context();
  ctx.WorldState = {
    HasA: 0,
    HasB: 0,
    HasC: 0,
  };
  ctx.init();
  return ctx;
};

test("GOAP sequence respects preconditions order", () => {
  const builder = new DomainBuilder<Context>("GOAP Test");

  builder.goapSequence("Achieve C", { HasC: 1 });

  builder
    .goapAction("Get C")
    .condition("Has B", (context) => context.hasState("HasB"))
    .condition("Has not C", (context) => !context.hasState("HasC"))
    .do(() => TaskStatus.Success)
    .effect("Set C", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasC", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("Get A")
    .condition("Has not A", (context) => !context.hasState("HasA"))
    .do(() => TaskStatus.Success)
    .effect("Set A", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasA", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("Get B")
    .condition("Has A", (context) => context.hasState("HasA"))
    .condition("Has not B", (context) => !context.hasState("HasB"))
    .do(() => TaskStatus.Success)
    .effect("Set B", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasB", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = createTestContext();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 3);
  assert.is(plan[0].Name, "Get A");
  assert.is(plan[1].Name, "Get B");
  assert.is(plan[2].Name, "Get C");
});

test("GOAP sequence prefers lower cumulative cost", () => {
  const builder = new DomainBuilder<Context>("GOAP Cost Test");

  builder.goapSequence("Achieve C", { HasC: 1 });

  builder
    .goapAction("Get C")
    .condition("Has A or B", (context) => context.hasState("HasA") || context.hasState("HasB"))
    .condition("Has not C", (context) => !context.hasState("HasC"))
    .do(() => TaskStatus.Success)
    .effect("Set C", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasC", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("Get B", () => 10)
    .condition("Has not B", (context) => !context.hasState("HasB"))
    .do(() => TaskStatus.Success)
    .effect("Set B", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasB", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("Get A")
    .condition("Has not A", (context) => !context.hasState("HasA"))
    .do(() => TaskStatus.Success)
    .effect("Set A", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasA", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = createTestContext();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "Get A");
  assert.is(plan[1].Name, "Get C");
});

test("GOAP sequence fails when goal is unreachable", () => {
  const builder = new DomainBuilder<Context>("GOAP Fail Test");

  builder.goapSequence("Achieve C", { HasC: 1 });

  builder
    .goapAction("Get A")
    .condition("Has not A", (context) => !context.hasState("HasA"))
    .do(() => TaskStatus.Success)
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = createTestContext();

  const { status, plan } = domain.findPlan(ctx);

  assert.ok(status === DecompositionStatus.Failed || status === DecompositionStatus.Rejected);
  assert.ok(plan);
  assert.equal(plan.length, 0);
});

test("GOAP sequence prefers cheaper multi-step path over expensive shortcut", () => {
  const builder = new DomainBuilder<Context>("GOAP Default Cost Test");

  builder.goapSequence("Achieve C", { HasC: 1 });

  builder
    .goapAction("Shortcut", () => 5)
    .condition("Has not C", (context) => !context.hasState("HasC"))
    .do(() => TaskStatus.Success)
    .effect("Set C", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasC", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("Get A")
    .condition("Has not A", (context) => !context.hasState("HasA"))
    .do(() => TaskStatus.Success)
    .effect("Set A", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasA", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("Get C")
    .condition("Has A", (context) => context.hasState("HasA"))
    .condition("Has not C", (context) => !context.hasState("HasC"))
    .do(() => TaskStatus.Success)
    .effect("Set C", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasC", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = createTestContext();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "Get A");
  assert.is(plan[1].Name, "Get C");
});

test("GOAP sequence avoids cycles while reaching goal", () => {
  const builder = new DomainBuilder<Context>("GOAP Cycle Test");

  builder.goapSequence("Toggle Goal", { GoalMet: 1 });

  builder
    .goapAction("ToggleSwitch")
    .do(() => TaskStatus.Success)
    .effect("Flip switch", EffectType.PlanOnly, (context, effectType) => {
      const current = context.getState("SwitchOn");
      const next = current === 1 ? 0 : 1;
      context.setState("SwitchOn", next, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("ReachGoal")
    .condition("Switch on", (context) => context.hasState("SwitchOn"))
    .do(() => TaskStatus.Success)
    .effect("Mark goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = { SwitchOn: 0, GoalMet: 0 };
  ctx.init();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "ToggleSwitch");
  assert.is(plan[1].Name, "ReachGoal");
});

test("GOAP sequence chooses deterministic path among equal costs", () => {
  const builder = new DomainBuilder<Context>("GOAP Equal Cost Test");

  builder.goapSequence("Reach Goal", { GoalMet: 1 });

  builder
    .goapAction("StartPathA")
    .do(() => TaskStatus.Success)
    .effect("StageA", EffectType.PlanOnly, (context, effectType) => {
      context.setState("StageA", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("FinishPathA")
    .condition("Has StageA", (context) => context.hasState("StageA"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("StartPathB")
    .do(() => TaskStatus.Success)
    .effect("StageB", EffectType.PlanOnly, (context, effectType) => {
      context.setState("StageB", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("FinishPathB")
    .condition("Has StageB", (context) => context.hasState("StageB"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = createTestContext();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "StartPathA");
  assert.is(plan[1].Name, "FinishPathA");
});

test("GOAP sequence skips irrelevant high-cost actions", () => {
  const builder = new DomainBuilder<Context>("GOAP Irrelevant Test");

  builder.goapSequence("Reach Goal", { GoalMet: 1 });

  builder
    .goapAction("PolishArmor", () => 100)
    .do(() => TaskStatus.Success)
    .effect("Shiny", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Shiny", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("AcquireKey")
    .condition("No Key", (context) => !context.hasState("HasKey"))
    .do(() => TaskStatus.Success)
    .effect("HasKey", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasKey", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("OpenDoor")
    .condition("Has Key", (context) => context.hasState("HasKey"))
    .condition("Door closed", (context) => !context.hasState("DoorOpen"))
    .do(() => TaskStatus.Success)
    .effect("DoorOpen", EffectType.PlanOnly, (context, effectType) => {
      context.setState("DoorOpen", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder
    .goapAction("ReachGoal")
    .condition("Door open", (context) => context.hasState("DoorOpen"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = {
    HasKey: 0,
    DoorOpen: 0,
    GoalMet: 0,
    Shiny: 0,
  };
  ctx.init();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 3);
  assert.is(plan[0].Name, "AcquireKey");
  assert.is(plan[1].Name, "OpenDoor");
  assert.is(plan[2].Name, "ReachGoal");
  assert.ok(plan.every((task) => task.Name !== "PolishArmor"));
});

test("GOAP sequence succeeds immediately when goal already satisfied", () => {
  const builder = new DomainBuilder<Context>("GOAP Goal Done Test");

  builder.goapSequence("Maintain Goal", { GoalMet: 1 });

  builder
    .goapAction("DoWork")
    .condition("Goal missing", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = { GoalMet: 1 };
  ctx.init();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 0);
});

test("GOAP sequence expands compound children and propagates cost", () => {
  const builder = new DomainBuilder<Context>("GOAP Compound Test");

  builder.goapSequence("Secure Loot", { HasLoot: 1 });

  builder
    .sequence("Stealth Route")
    .cost(() => 2)
    .action("PickLock")
      .condition("Door closed", (context) => !context.hasState("DoorOpen"))
      .do(() => TaskStatus.Success)
      .effect("DoorOpen", EffectType.PlanOnly, (context, effectType) => {
        context.setState("DoorOpen", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end()
    .action("GrabLoot")
      .condition("Door open", (context) => context.hasState("DoorOpen"))
      .condition("No loot", (context) => !context.hasState("HasLoot"))
      .do(() => TaskStatus.Success)
      .effect("HasLoot", EffectType.PlanOnly, (context, effectType) => {
        context.setState("HasLoot", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end()
  .end();

  builder
    .goapAction("BlastDoor", () => 8)
    .condition("No loot", (context) => !context.hasState("HasLoot"))
    .do(() => TaskStatus.Success)
    .effect("HasLoot", EffectType.PlanOnly, (context, effectType) => {
      context.setState("HasLoot", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = {
    DoorOpen: 0,
    HasLoot: 0,
  };
  ctx.init();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "PickLock");
  assert.is(plan[1].Name, "GrabLoot");
});

test("GOAP dynamic costs respond to injury and vehicle state", () => {
  const builder = new DomainBuilder<Context>("GOAP Dynamic Cost Test");

  const movementGoal = { AtTarget: 1 };
  const targetNode = "B";

  const distance = (from: string, to: string): number => {
    const coords: Record<string, [number, number]> = {
      A: [0, 0],
      B: [3, 0],
      C: [1, 2],
    };
    const [fx, fy] = coords[from];
    const [tx, ty] = coords[to];
    const dx = fx - tx;
    const dy = fy - ty;
    return Math.sqrt(dx * dx + dy * dy);
  };

  builder.goapSequence("ReachTarget", movementGoal);

  builder
    .goapAction("WalkToTarget", (context) => {
      const from = context.getState("AgentNode") as string;
      const meters = distance(from, targetNode);
      const injuryMultiplier = context.hasState("LegInjured") ? 2 : 1;
      return meters * injuryMultiplier;
    })
    .do(() => TaskStatus.Success)
    .effect("Update position", EffectType.PlanOnly, (context, effectType) => {
      context.setState("AgentNode", targetNode, false, effectType ?? EffectType.PlanOnly);
      context.setState("AtTarget", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("DriveToTarget", (context) => {
      const hasVehicle = context.hasState("HasVehicle");
      if (!hasVehicle) {
        return Number.POSITIVE_INFINITY;
      }
      const from = context.getState("AgentNode") as string;
      const meters = distance(from, targetNode);
      // driving is cheaper per meter
      return meters * 0.5;
    })
    .do(() => TaskStatus.Success)
    .effect("Drive", EffectType.PlanOnly, (context, effectType) => {
      context.setState("AgentNode", targetNode, false, effectType ?? EffectType.PlanOnly);
      context.setState("AtTarget", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder.end();

  const domain = builder.build();

  const walkCtx = new Context();
  walkCtx.WorldState = {
    AgentNode: "A",
    AtTarget: 0,
    LegInjured: 1,
    HasVehicle: 0,
  };
  walkCtx.init();

  const driveCtx = new Context();
  driveCtx.WorldState = {
    AgentNode: "A",
    AtTarget: 0,
    LegInjured: 1,
    HasVehicle: 1,
  };
  driveCtx.init();

  const walkPlan = domain.findPlan(walkCtx);
  assert.equal(walkPlan.status, DecompositionStatus.Succeeded);
  assert.equal(walkPlan.plan.length, 1);
  assert.is(walkPlan.plan[0].Name, "WalkToTarget");

  const drivePlan = domain.findPlan(driveCtx);
  assert.equal(drivePlan.status, DecompositionStatus.Succeeded);
  assert.equal(drivePlan.plan.length, 1);
  assert.is(drivePlan.plan[0].Name, "DriveToTarget");
});

test("GOAP A* defaults to uniform cost when heuristic is absent", () => {
  const builder = new DomainBuilder<Context>("GOAP Default Search");

  builder.goapSequence("Reach Goal", { GoalMet: 1 });

  builder
    .goapAction("Shortcut", () => 5)
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("Prepare", () => 2)
    .condition("Unprepared", (context) => !context.hasState("Prepared"))
    .do(() => TaskStatus.Success)
    .effect("Mark prepared", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Prepared", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("Finish", () => 2)
    .condition("Prepared", (context) => context.hasState("Prepared"))
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = { GoalMet: 0, Prepared: 0 };
  ctx.init();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "Prepare");
  assert.is(plan[1].Name, "Finish");
});

test("GOAP admissible heuristic matches UCS plan", () => {
  const baseline = new DomainBuilder<Context>("GOAP Baseline");
  baseline.goapSequence("Reach Goal", { GoalMet: 1 });

  baseline
    .goapAction("Shortcut", () => 5)
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  baseline
    .goapAction("Prepare", () => 2)
    .condition("Unprepared", (context) => !context.hasState("Prepared"))
    .do(() => TaskStatus.Success)
    .effect("Mark prepared", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Prepared", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  baseline
    .goapAction("Finish", () => 2)
    .condition("Prepared", (context) => context.hasState("Prepared"))
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  baseline.end();

  const heuristicBuilder = new DomainBuilder<Context>("GOAP AStar");
  heuristicBuilder.goapSequence("Reach Goal", { GoalMet: 1 });

  heuristicBuilder
    .goapAction("Shortcut", () => 5)
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  heuristicBuilder
    .goapAction("Prepare", () => 2)
    .condition("Unprepared", (context) => !context.hasState("Prepared"))
    .do(() => TaskStatus.Success)
    .effect("Mark prepared", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Prepared", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  heuristicBuilder
    .goapAction("Finish", () => 2)
    .condition("Prepared", (context) => context.hasState("Prepared"))
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  heuristicBuilder.goapHeuristic((context, _goal) => {
    if (context.hasState("GoalMet")) {
      return 0;
    }

    if (context.hasState("Prepared")) {
      return 2;
    }

    return 4;
  });

  heuristicBuilder.end();

  const baselineDomain = baseline.build();
  const heuristicDomain = heuristicBuilder.build();

  const baselineContext = new Context();
  baselineContext.WorldState = { GoalMet: 0, Prepared: 0 };
  baselineContext.init();

  const heuristicContext = new Context();
  heuristicContext.WorldState = { GoalMet: 0, Prepared: 0 };
  heuristicContext.init();

  const baselinePlan = baselineDomain.findPlan(baselineContext);
  const heuristicPlan = heuristicDomain.findPlan(heuristicContext);

  assert.equal(baselinePlan.status, DecompositionStatus.Succeeded);
  assert.equal(heuristicPlan.status, DecompositionStatus.Succeeded);
  assert.equal(baselinePlan.plan.length, heuristicPlan.plan.length);
  assert.equal(
    baselinePlan.plan.map((task) => task.Name).join(","),
    heuristicPlan.plan.map((task) => task.Name).join(","),
  );
});

test("GOAP weighted A* may return a more expensive plan", () => {
  const builder = new DomainBuilder<Context>("GOAP Weighted");

  builder.goapSequence("Reach Goal", { GoalMet: 1 });

  builder
    .goapAction("Shortcut", () => 5)
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("Prepare", () => 2)
    .condition("Unprepared", (context) => !context.hasState("Prepared"))
    .do(() => TaskStatus.Success)
    .effect("Mark prepared", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Prepared", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("Finish", () => 2)
    .condition("Prepared", (context) => context.hasState("Prepared"))
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder.goapHeuristic((context, _goal) => {
    if (context.hasState("GoalMet")) {
      return 0;
    }

    if (context.hasState("Prepared")) {
      return 2;
    }

    return 4;
  });

  builder.goapHeuristicWeight(2);

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = { GoalMet: 0, Prepared: 0 };
  ctx.init();

  const result = domain.findPlan(ctx);

  assert.equal(result.status, DecompositionStatus.Succeeded);
  assert.ok(result.plan);
  assert.equal(result.plan.length, 1);
  assert.is(result.plan[0].Name, "Shortcut");
});

test("GOAP heuristic falling back from NaN or negative values", () => {
  const baselineBuilder = new DomainBuilder<Context>("GOAP Safe Baseline");
  baselineBuilder.goapSequence("Reach Goal", { GoalMet: 1 });

  baselineBuilder
    .goapAction("StepOne")
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Progress", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Progress", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  baselineBuilder
    .goapAction("StepTwo")
    .condition("Progress", (context) => context.hasState("Progress"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  baselineBuilder.end();

  const heuristicBuilder = new DomainBuilder<Context>("GOAP Unsafe Heuristic");
  heuristicBuilder.goapSequence("Reach Goal", { GoalMet: 1 });

  heuristicBuilder
    .goapAction("StepOne")
    .condition("Missing goal", (context) => !context.hasState("GoalMet"))
    .do(() => TaskStatus.Success)
    .effect("Progress", EffectType.PlanOnly, (context, effectType) => {
      context.setState("Progress", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  heuristicBuilder
    .goapAction("StepTwo")
    .condition("Progress", (context) => context.hasState("Progress"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  heuristicBuilder.goapHeuristic((context, _goal) => {
    if (context.hasState("GoalMet")) {
      return -1;
    }

    if (context.hasState("Progress")) {
      return Number.NaN;
    }

    return Number.POSITIVE_INFINITY;
  });

  heuristicBuilder.end();

  const baselineDomain = baselineBuilder.build();
  const heuristicDomain = heuristicBuilder.build();

  const baselineContext = new Context();
  baselineContext.WorldState = { GoalMet: 0, Progress: 0 };
  baselineContext.init();

  const heuristicContext = new Context();
  heuristicContext.WorldState = { GoalMet: 0, Progress: 0 };
  heuristicContext.init();

  const baselinePlan = baselineDomain.findPlan(baselineContext);
  const heuristicPlan = heuristicDomain.findPlan(heuristicContext);

  assert.equal(baselinePlan.status, DecompositionStatus.Succeeded);
  assert.equal(heuristicPlan.status, DecompositionStatus.Succeeded);
  assert.equal(
    baselinePlan.plan.map((task) => task.Name).join(","),
    heuristicPlan.plan.map((task) => task.Name).join(","),
  );
});

test("GOAP heuristic maintains deterministic tie-breaking", () => {
  const builder = new DomainBuilder<Context>("GOAP Deterministic Heuristic");

  builder.goapSequence("Reach Goal", { GoalMet: 1 });

  builder
    .goapAction("StartPathA")
    .do(() => TaskStatus.Success)
    .effect("StageA", EffectType.PlanOnly, (context, effectType) => {
      context.setState("StageA", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("FinishPathA")
    .condition("Has StageA", (context) => context.hasState("StageA"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("StartPathB")
    .do(() => TaskStatus.Success)
    .effect("StageB", EffectType.PlanOnly, (context, effectType) => {
      context.setState("StageB", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .goapAction("FinishPathB")
    .condition("Has StageB", (context) => context.hasState("StageB"))
    .do(() => TaskStatus.Success)
    .effect("Goal", EffectType.PlanOnly, (context, effectType) => {
      context.setState("GoalMet", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder.goapHeuristic((_context, _goal) => 1);

  builder.end();

  const domain = builder.build();
  const ctx = new Context();
  ctx.WorldState = { GoalMet: 0, StageA: 0, StageB: 0 };
  ctx.init();

  const plan = domain.findPlan(ctx);

  assert.equal(plan.status, DecompositionStatus.Succeeded);
  assert.ok(plan.plan);
  assert.equal(plan.plan.length, 2);
  assert.is(plan.plan[0].Name, "StartPathA");
  assert.is(plan.plan[1].Name, "FinishPathA");
});

test("GOAP heuristic smoke test on branching domain", () => {
  const buildDomain = (withHeuristic: boolean): DomainBuilder<Context> => {
    const builder = new DomainBuilder<Context>(`GOAP Branching ${withHeuristic ? "A*" : "UCS"}`);
    builder.goapSequence("Collect Items", { HasGem: 1, HasKey: 1 });

    builder
      .goapAction("CollectGem", () => 3)
      .condition("Missing gem", (context) => !context.hasState("HasGem"))
      .do(() => TaskStatus.Success)
      .effect("Gem", EffectType.PlanOnly, (context, effectType) => {
        context.setState("HasGem", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end();

    builder
      .goapAction("CollectKey", () => 2)
      .condition("Missing key", (context) => !context.hasState("HasKey"))
      .do(() => TaskStatus.Success)
      .effect("Key", EffectType.PlanOnly, (context, effectType) => {
        context.setState("HasKey", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end();

    builder
      .goapAction("TalkToNPC", () => 1)
      .condition("Not met", (context) => !context.hasState("MetNPC"))
      .do(() => TaskStatus.Success)
      .effect("MetNPC", EffectType.PlanOnly, (context, effectType) => {
        context.setState("MetNPC", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end();

    builder
      .goapAction("TradeForGem", () => 2)
      .condition("Met NPC", (context) => context.hasState("MetNPC"))
      .condition("Missing gem", (context) => !context.hasState("HasGem"))
      .do(() => TaskStatus.Success)
      .effect("Gem", EffectType.PlanOnly, (context, effectType) => {
        context.setState("HasGem", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end();

    builder
      .goapAction("SearchChest", () => 4)
      .condition("Missing key", (context) => !context.hasState("HasKey"))
      .do(() => TaskStatus.Success)
      .effect("Key", EffectType.PlanOnly, (context, effectType) => {
        context.setState("HasKey", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end();

    if (withHeuristic) {
      builder.goapHeuristic((context, goal) => {
        let missing = 0;
        for (const [key, value] of Object.entries(goal)) {
          if ((context.getState(key as never) as number) !== value) {
            missing += 1;
          }
        }

        return missing;
      });
    }

    builder.end();
    return builder;
  };

  const baselineDomain = buildDomain(false).build();
  const heuristicDomain = buildDomain(true).build();

  const createContext = (): Context => {
    const ctx = new Context();
    ctx.WorldState = {
      HasGem: 0,
      HasKey: 0,
      MetNPC: 0,
    };
    ctx.init();
    return ctx;
  };

  const baselineContext = createContext();
  const heuristicContext = createContext();

  const baselineStart = performance.now();
  const baselinePlan = baselineDomain.findPlan(baselineContext);
  const baselineDuration = performance.now() - baselineStart;

  const heuristicStart = performance.now();
  const heuristicPlan = heuristicDomain.findPlan(heuristicContext);
  const heuristicDuration = performance.now() - heuristicStart;

  assert.equal(baselinePlan.status, DecompositionStatus.Succeeded);
  assert.equal(heuristicPlan.status, DecompositionStatus.Succeeded);
  assert.equal(
    baselinePlan.plan.map((task) => task.Name).join(","),
    heuristicPlan.plan.map((task) => task.Name).join(","),
  );
  assert.ok(Number.isFinite(baselineDuration));
  assert.ok(Number.isFinite(heuristicDuration));
});

test.run();

