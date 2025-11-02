import { test } from "uvu";
import * as assert from "uvu/assert";
import Planner from "../../src/planner";
import {
  compileGoalProgram,
  GoalPlanningContext,
  DemoWorld,
  DemoNavigationPlanner,
  examplePrograms,
  DoInOrder,
  CompleteWithin,
  MoveToRegion,
  seconds,
  NavigationConstraints,
  SpeakMessage,
  ApplyNavigationConstraints,
  createCorridorWithGuideProgram,
} from "../../src/examples/goalPlanning";
import type Domain from "../../src/domain";
import type CompoundTask from "../../src/Tasks/compoundTask";

const SCENARIOS_TO_RUN = [
  "EnterThenDwell",
  "FollowPauseLeave",
  "EscortVIP",
  "InspectWaypoints",
  "ChargingLatch",
  "TwoLegPatrol",
  "EmergencyPath",
  "EscortWithHazardAvoidance",
] as const;

type ScenarioKey = keyof typeof examplePrograms;

const EXPECTED_MESSAGES: Partial<Record<ScenarioKey, string>> = {
  EnterThenDwell: "Arrived and dwelled in stage area.",
  FollowPauseLeave: "Done following Alice, now at a safe distance.",
  EscortVIP: "VIP escorted to lobby.",
  InspectWaypoints: "All waypoints inspected.",
  ChargingLatch: "Charging latch secured.",
  FieldHandoffFollow: "Hand-off and guided follow completed.",
  TwoLegPatrol: "Patrol complete.",
  EmergencyPath: "Emergency path completed under deadline.",
  EscortWithHazardAvoidance: "VIP escorted, hazards avoided.",
};

interface RunResult {
  context: GoalPlanningContext;
  ticks: number;
}

const runScenario = (name: ScenarioKey, maxTicks = 1500): RunResult => {
  const world = new DemoWorld();
  const navigation = new DemoNavigationPlanner(world);
  const context = new GoalPlanningContext(world, navigation);
  context.init();

  const programFactory = examplePrograms[name];
  if (!programFactory) {
    throw new Error(`Unknown scenario: ${name}`);
  }

  const domain = compileGoalProgram(name, programFactory());
  const planner = new Planner<GoalPlanningContext>();

  let ticks = 0;
  while (!context.programCompleted && ticks < maxTicks) {
    planner.tick(domain, context);
    world.advance(0.1);
    ticks += 1;
  }

  return { context, ticks };
};

test("goal planning core scenarios complete", () => {
  for (const name of SCENARIOS_TO_RUN) {
    const { context, ticks } = runScenario(name);
    assert.ok(context.programCompleted, `${name} should complete within allotted ticks`);
    const expectedMessage = EXPECTED_MESSAGES[name];
    if (expectedMessage) {
      assert.ok(
        context.messages.includes(expectedMessage),
        `${name} should produce terminal message '${expectedMessage}'`,
      );
    }
    assert.ok(ticks < 1500, `${name} should not hit max tick bound`);
  }
});

test("deadline guard aborts impossible move", () => {
  const world = new DemoWorld();
  const navigation = new DemoNavigationPlanner(world);
  const context = new GoalPlanningContext(world, navigation);
  context.init();

  const impossibleProgram = new DoInOrder(
    new CompleteWithin(seconds(1), new MoveToRegion("egress")),
  );

  const domain = compileGoalProgram("ImpossibleDeadline", impossibleProgram);
  const planner = new Planner<GoalPlanningContext>();

  let ticks = 0;
  const maxTicks = 250;
  while (!context.programCompleted && ticks < maxTicks) {
    planner.tick(domain, context);
    world.advance(0.1);
    ticks += 1;
  }

  assert.not(context.programCompleted, "Program should fail when deadline cannot be met");
});

test("navigation constraint wrapper emits push/pop actions", () => {
  const constraints = new NavigationConstraints();
  constraints.maximumSpeedMetersPerSecond = 0.5;
  const program = new ApplyNavigationConstraints(constraints, new SpeakMessage("Constraint test"));
  const domain = compileGoalProgram("ConstraintScope", program);
  const names = collectTaskNames(domain);
  assert.ok(names.includes("Push Constraints"), "push action should be present");
  assert.ok(names.includes("Pop Constraints"), "pop action should be present");
});

const collectTaskNames = (domain: Domain<GoalPlanningContext>): string[] => {
  const names: string[] = [];
  const visit = (task: CompoundTask | { Name?: string; Children?: unknown[] }) => {
    if (!task || typeof task !== "object") {
      return;
    }
    if ("Name" in task && typeof task.Name === "string") {
      names.push(task.Name);
    }
    if ("Children" in task && Array.isArray(task.Children)) {
      for (const child of task.Children) {
        if (child && typeof child === "object") {
          visit(child as CompoundTask);
        }
      }
    }
  };

  visit(domain.Root);
  return names;
};

test("while condition inserts guard primitives", () => {
  const domain = compileGoalProgram("CorridorGuard", createCorridorWithGuideProgram());
  const names = collectTaskNames(domain);
  assert.ok(names.includes("While Condition Guard"), "guard primitive should be present");
  assert.ok(names.includes("While Condition Skipped"), "skip primitive should be present");
});

