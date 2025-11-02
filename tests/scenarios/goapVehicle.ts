import { test } from "uvu";
import * as assert from "uvu/assert";
import Context from "../../src/context";
import DomainBuilder from "../../src/domainBuilder";
import DecompositionStatus from "../../src/decompositionStatus";
import TaskStatus from "../../src/taskStatus";
import { EffectType } from "../../src/effectType";

const POINTS: Record<string, [number, number]> = {
  A: [0, 0],
  VehicleDepot: [2, 1],
  Destination: [8, 0],
};

const TARGET_NODE = "Destination";
const VEHICLE_NODE = "VehicleDepot";

function distance(from: string, to: string): number {
  const [fx, fy] = POINTS[from];
  const [tx, ty] = POINTS[to];
  const dx = fx - tx;
  const dy = fy - ty;
  return Math.sqrt(dx * dx + dy * dy);
}

function createVehicleDomain(): DomainBuilder<Context> {
  const builder = new DomainBuilder<Context>("Vehicle Scenario");

  builder.goapSequence("Reach Destination", { AtTarget: 1 });

  builder
    .goapAction("WalkDirect", (context) => {
      const from = context.getState("AgentNode") as string;
      const meters = distance(from, TARGET_NODE);
      const injuryMultiplier = context.hasState("LegInjured") ? 2 : 1;
      return meters * injuryMultiplier;
    })
    .condition("Vehicle unavailable", (context) => !context.hasState("HasVehicle"))
    .do(() => TaskStatus.Success)
    .effect("Reach target", EffectType.PlanOnly, (context, effectType) => {
      context.setState("AgentNode", TARGET_NODE, false, effectType ?? EffectType.PlanOnly);
      context.setState("AtTarget", 1, false, effectType ?? EffectType.PlanOnly);
    })
  .end();

  builder
    .sequence("Vehicle Route")
    .goapAction("WalkToVehicle", (context) => {
      const from = context.getState("AgentNode") as string;
      const meters = distance(from, VEHICLE_NODE);
      const injuryMultiplier = context.hasState("LegInjured") ? 2 : 1;
      return meters * injuryMultiplier;
    })
      .condition("Vehicle present", (context) => context.hasState("VehicleAvailable"))
      .condition("Not already at vehicle", (context) => context.getState("AgentNode") !== VEHICLE_NODE)
      .do(() => TaskStatus.Success)
      .effect("Arrive at vehicle", EffectType.PlanOnly, (context, effectType) => {
        context.setState("AgentNode", VEHICLE_NODE, false, effectType ?? EffectType.PlanOnly);
        context.setState("HasVehicle", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end()
    .goapAction("DriveToTarget", (context) => {
      if (!context.hasState("HasVehicle")) {
        return Number.POSITIVE_INFINITY;
      }
      const from = context.getState("AgentNode") as string;
      const meters = distance(from, TARGET_NODE);
      return meters * 0.5;
    })
      .condition("Have vehicle", (context) => context.hasState("HasVehicle"))
      .do(() => TaskStatus.Success)
      .effect("Arrive by vehicle", EffectType.PlanOnly, (context, effectType) => {
        context.setState("AgentNode", TARGET_NODE, false, effectType ?? EffectType.PlanOnly);
        context.setState("AtTarget", 1, false, effectType ?? EffectType.PlanOnly);
      })
    .end()
  .end();

  builder.end();

  return builder;
}

function createScenarioContext(overrides: Partial<Record<string, number | string>> = {}): Context {
  const context = new Context();
  context.WorldState = {
    AgentNode: "A",
    AtTarget: 0,
    LegInjured: 0,
    HasVehicle: 0,
    VehicleAvailable: 1,
    ...overrides,
  } as Record<string, number | string>;
  context.init();
  return context;
}

test("Scenario: prefers vehicle detour when cheaper", () => {
  const builder = createVehicleDomain();
  const domain = builder.build();

  const ctx = createScenarioContext({ LegInjured: 1 });

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "WalkToVehicle");
  assert.is(plan[1].Name, "DriveToTarget");
});

test("Scenario: walks directly when vehicle unavailable", () => {
  const builder = createVehicleDomain();
  const domain = builder.build();

  const ctx = createScenarioContext({ VehicleAvailable: 0, LegInjured: 1 });

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.is(plan[0].Name, "WalkDirect");
});

test.run();

