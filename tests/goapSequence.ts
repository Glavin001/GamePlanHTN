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
      const from = context.getState("AgentNode");
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
      const from = context.getState("AgentNode");
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

test.run();

