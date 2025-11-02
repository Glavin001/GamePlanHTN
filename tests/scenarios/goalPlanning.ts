import { test } from "uvu";
import * as assert from "uvu/assert";
import Planner from "../../src/planner";
import {
  ApplyNavigationConstraints,
  CompleteWithin,
  DistanceToAtLeast,
  DistanceToAtMost,
  DoInOrder,
  FollowEntity,
  GoalPlanningContext,
  GoalPlanningWorld,
  GoalProgram,
  HasLineOfSightTo,
  HoldPosition,
  MaintainForAtLeast,
  MoveAwayFrom,
  MoveToRegion,
  NavigationConstraints,
  NavigationPlanner,
  Pose,
  SpeakMessage,
  WhileConditionHolds,
  also,
  compileGoalProgram,
  minutes,
  offsetPose,
  pose,
  seconds,
} from "../../src/goalPlanning";
import type Domain from "../../src/domain";
import type CompoundTask from "../../src/Tasks/compoundTask";

const regionCenter = (region: string): Pose => {
  switch (region.toLowerCase()) {
    case "stage_area":
      return pose(10, 0);
    case "lobby":
      return pose(0, -10);
    case "w1":
      return pose(-3, 3);
    case "w2":
      return pose(3, 3);
    case "w3":
      return pose(0, 6);
    case "egress":
      return pose(-10, -10);
    case "dock_a":
      return pose(0, 8);
    case "charging_bay":
      return pose(7, 7);
    case "construction_zone":
      return pose(2, 2);
    case "kitchen":
      return pose(1, 5);
    default:
      return pose(0, 0);
  }
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalized = (dx: number, dy: number): { x: number; y: number } => {
  const length = Math.hypot(dx, dy);
  if (length < 1e-5) {
    return { x: 0, y: 0 };
  }
  return { x: dx / length, y: dy / length };
};

class DemoWorld implements GoalPlanningWorld {
  private readonly entities = new Map<string, Pose>([
    ["alice", pose(5, 0)],
    ["vip_42", pose(0, 10)],
    ["player_7", pose(-5, 0)],
    ["guide_bot", pose(2, 0)],
    ["beacon1", pose(4, 4)],
  ]);

  private timeSeconds = 0;

  private readonly losSchedule = new Map<string, Array<{ start: number; end: number }>>([
    ["guide_bot", [{ start: 3, end: 8 }]],
    ["beacon1", [
      { start: 4, end: 6 },
      { start: 12, end: 14 },
    ]],
    ["vip_42", [{ start: 10, end: 13 }]],
  ]);

  get now(): number {
    return this.timeSeconds;
  }

  advance(secondsToAdvance: number): void {
    this.timeSeconds += secondsToAdvance;
    this.updateEntity("alice", 0.03 * secondsToAdvance, 0);
    this.updateEntity("player_7", 0.02 * secondsToAdvance, 0.01 * secondsToAdvance);
    this.updateEntity("guide_bot", 0.01 * secondsToAdvance, 0);
    this.updateEntity("vip_42", 0.008 * secondsToAdvance, -0.01 * secondsToAdvance);
  }

  isInsideRegion(position: Pose, region: string): boolean {
    if (region.toLowerCase() === "east_corridor") {
      return Math.abs(position.x) <= 1 && position.y >= -5 && position.y <= 10;
    }

    const center = regionCenter(region);
    return this.distance(position, center) <= 1.0;
  }

  getEntityPose(entityId: string): Pose {
    return this.entities.get(entityId.toLowerCase()) ?? pose(0, 0, 0);
  }

  distance(a: Pose, b: Pose): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  hasLineOfSight(observer: Pose, target: Pose, entityId: string): boolean {
    observer;
    target;
    const schedule = this.losSchedule.get(entityId.toLowerCase());
    if (!schedule) {
      return true;
    }

    const t = this.timeSeconds;
    return !schedule.some(({ start, end }) => t >= start && t < end);
  }

  private updateEntity(id: string, dx: number, dy: number): void {
    const current = this.entities.get(id);
    if (!current) {
      return;
    }

    this.entities.set(id, offsetPose(current, dx, dy));
  }
}

class DemoNavigationPlanner implements NavigationPlanner {
  constructor(private readonly world: GoalPlanningWorld) {}

  hasCompliantPath(
    start: Pose,
    goalRegion: string | null,
    constraints: NavigationConstraints,
    deadlineSeconds: number | null,
  ): boolean {
    if (!goalRegion) {
      return true;
    }

    const goal = regionCenter(goalRegion);
    const speed = Math.max(constraints.maximumSpeedMetersPerSecond ?? 1, 0.25);
    const required = this.world.distance(start, goal) / speed;
    if (deadlineSeconds == null) {
      return true;
    }

    return required <= deadlineSeconds + 0.5;
  }

  stepTowardRegion(start: Pose, goalRegion: string, constraints: NavigationConstraints): Pose | null {
    const goal = regionCenter(goalRegion);
    const dir = normalized(goal.x - start.x, goal.y - start.y);
    const speed = Math.max(constraints.maximumSpeedMetersPerSecond ?? 1, 0.25);
    const stepSize = speed * 0.2;
    let candidate = offsetPose(start, dir.x * stepSize, dir.y * stepSize);

    if (constraints.keepWithinRegion) {
      if (constraints.keepWithinRegion.toLowerCase() === "east_corridor") {
        candidate = pose(clamp(candidate.x, -1, 1), clamp(candidate.y, -5, 5), candidate.z);
      } else if (!this.world.isInsideRegion(candidate, constraints.keepWithinRegion)) {
        const keepCenter = regionCenter(constraints.keepWithinRegion);
        const backDir = normalized(keepCenter.x - candidate.x, keepCenter.y - candidate.y);
        candidate = offsetPose(candidate, backDir.x * 0.1, backDir.y * 0.1);
      }
    }

    if (constraints.avoidRegions.size > 0) {
      for (const region of constraints.avoidRegions) {
        if (this.world.isInsideRegion(candidate, region)) {
          const perp = { x: -dir.y, y: dir.x };
          candidate = offsetPose(candidate, perp.x * stepSize * 0.5, perp.y * stepSize * 0.5);
        }
      }
    }

    return candidate;
  }

  stepToFollow(
    start: Pose,
    target: Pose,
    radius: number,
    constraints: NavigationConstraints,
  ): Pose | null {
    const distance = this.world.distance(start, target);
    const speed = Math.max(constraints.maximumSpeedMetersPerSecond ?? 1, 0.25);
    const stepSize = speed * 0.18;

    if (distance <= radius * 0.9) {
      const away = normalized(start.x - target.x, start.y - target.y);
      return offsetPose(start, away.x * stepSize * 0.5, away.y * stepSize * 0.5);
    }

    const toward = normalized(target.x - start.x, target.y - start.y);
    return offsetPose(start, toward.x * stepSize, toward.y * stepSize);
  }

  stepToLeave(
    start: Pose,
    target: Pose,
    minimumDistance: number,
    constraints: NavigationConstraints,
  ): Pose | null {
    const distance = this.world.distance(start, target);
    if (distance >= minimumDistance) {
      return start;
    }

    const away = normalized(start.x - target.x, start.y - target.y);
    const speed = Math.max(constraints.maximumSpeedMetersPerSecond ?? 1, 0.25);
    const stepSize = speed * 0.22;
    return offsetPose(start, away.x * stepSize, away.y * stepSize);
  }
}

const createEnterThenDwellProgram = (): GoalProgram =>
  new DoInOrder(
    new CompleteWithin(seconds(10), new MoveToRegion("stage_area")),
    new MaintainForAtLeast(seconds(5), new HoldPosition(seconds(5))),
    new SpeakMessage("Arrived and dwelled in stage area."),
  );

const createFollowPauseLeaveProgram = (): GoalProgram =>
  new DoInOrder(
    new MaintainForAtLeast(seconds(10), new FollowEntity("alice", 1)),
    new MaintainForAtLeast(seconds(5), new HoldPosition(seconds(5))),
    new MoveAwayFrom("alice", 3),
    new SpeakMessage("Done following Alice, now at a safe distance."),
  );

const createEscortVipProgram = (): GoalProgram =>
  new ApplyNavigationConstraints(
    also(new NavigationConstraints(), (c) => {
      c.maximumSpeedMetersPerSecond = 1.2;
      c.avoidRegions.add("construction_zone");
    }),
    new DoInOrder(
      new MaintainForAtLeast(seconds(15), new FollowEntity("vip_42", 1)),
      new MoveToRegion("lobby"),
      new SpeakMessage("VIP escorted to lobby."),
    ),
  );

const createCorridorWithGuideProgram = (): GoalProgram =>
  new ApplyNavigationConstraints(
    also(new NavigationConstraints(), (c) => {
      c.keepWithinRegion = "east_corridor";
    }),
    new DoInOrder(
      new WhileConditionHolds(new HasLineOfSightTo("guide_bot"), new MoveToRegion("dock_a")),
      new MaintainForAtLeast(seconds(10), new HoldPosition(seconds(10))),
      new SpeakMessage("Lost guide line-of-sight; waited at safe stop."),
    ),
  );

const createInspectWaypointsProgram = (): GoalProgram =>
  new ApplyNavigationConstraints(
    also(new NavigationConstraints(), (c) => {
      c.avoidRegions.add("kitchen");
    }),
    new DoInOrder(
      new CompleteWithin(
        minutes(5),
        new DoInOrder(new MoveToRegion("w1"), new MoveToRegion("w2"), new MoveToRegion("w3")),
      ),
      new SpeakMessage("All waypoints inspected."),
    ),
  );

const createChargingLatchProgram = (): GoalProgram =>
  new DoInOrder(
    new CompleteWithin(seconds(30), new MoveToRegion("charging_bay")),
    new MaintainForAtLeast(seconds(10), new HoldPosition(seconds(10))),
    new SpeakMessage("Charging latch secured."),
  );

const createFieldHandoffProgram = (): GoalProgram =>
  new DoInOrder(
    new CompleteWithin(seconds(25), new MoveToRegion("stage_area")),
    new ApplyNavigationConstraints(
      also(new NavigationConstraints(), (c) => {
        c.keepWithinRegion = "east_corridor";
      }),
      new MaintainForAtLeast(seconds(12), new FollowEntity("player_7", 1.2)),
    ),
    new MaintainForAtLeast(seconds(4), new HoldPosition(seconds(4))),
    new SpeakMessage("Hand-off and guided follow completed."),
  );

const createDockWithBeaconProgram = (): GoalProgram =>
  new ApplyNavigationConstraints(
    also(new NavigationConstraints(), (c) => {
      c.keepWithinRegion = "east_corridor";
    }),
    new DoInOrder(
      new WhileConditionHolds(new HasLineOfSightTo("beacon1"), new MoveToRegion("dock_a")),
      new MaintainForAtLeast(seconds(5), new HoldPosition(seconds(5))),
      new WhileConditionHolds(new HasLineOfSightTo("beacon1"), new MoveToRegion("dock_a")),
      new SpeakMessage("Docked with intermittent beacon."),
    ),
  );

const createTwoLegPatrolProgram = (): GoalProgram =>
  new DoInOrder(
    new CompleteWithin(seconds(20), new MoveToRegion("w1")),
    new MaintainForAtLeast(seconds(5), new HoldPosition(seconds(5))),
    new WhileConditionHolds(new DistanceToAtLeast("player_7", 2), new MoveToRegion("w2")),
    new MaintainForAtLeast(seconds(5), new HoldPosition(seconds(5))),
    new MoveToRegion("egress"),
    new SpeakMessage("Patrol complete."),
  );

const createCorridorMergeProgram = (): GoalProgram =>
  new DoInOrder(
    new ApplyNavigationConstraints(
      also(new NavigationConstraints(), (c) => {
        c.maximumSpeedMetersPerSecond = 0.7;
      }),
      new WhileConditionHolds(new DistanceToAtMost("alice", 2), new MoveToRegion("lobby")),
    ),
    new ApplyNavigationConstraints(
      also(new NavigationConstraints(), (c) => {
        c.maximumSpeedMetersPerSecond = 1.2;
      }),
      new MoveToRegion("lobby"),
    ),
    new SpeakMessage("Arrived with courteous pacing."),
  );

const createEmergencyPathProgram = (): GoalProgram =>
  new DoInOrder(
    new CompleteWithin(
      seconds(40),
      new WhileConditionHolds(new HasLineOfSightTo("beacon1"), new MoveToRegion("egress")),
    ),
    new MaintainForAtLeast(seconds(2), new HoldPosition(seconds(2))),
    new WhileConditionHolds(new HasLineOfSightTo("beacon1"), new MoveToRegion("egress")),
    new SpeakMessage("Emergency path completed under deadline."),
  );

const createEscortWithHazardProgram = (): GoalProgram =>
  new ApplyNavigationConstraints(
    also(new NavigationConstraints(), (c) => {
      c.avoidRegions.add("construction_zone");
    }),
    new DoInOrder(
      new WhileConditionHolds(
        new HasLineOfSightTo("vip_42"),
        new MaintainForAtLeast(seconds(18), new FollowEntity("vip_42", 1)),
      ),
      new MaintainForAtLeast(seconds(5), new HoldPosition(seconds(5))),
      new WhileConditionHolds(new HasLineOfSightTo("vip_42"), new MoveToRegion("lobby")),
      new SpeakMessage("VIP escorted, hazards avoided."),
    ),
  );

const examplePrograms = {
  EnterThenDwell: createEnterThenDwellProgram,
  FollowPauseLeave: createFollowPauseLeaveProgram,
  EscortVIP: createEscortVipProgram,
  CorridorWithGuide: createCorridorWithGuideProgram,
  InspectWaypoints: createInspectWaypointsProgram,
  ChargingLatch: createChargingLatchProgram,
  FieldHandoffFollow: createFieldHandoffProgram,
  DockWithBeacon: createDockWithBeaconProgram,
  TwoLegPatrol: createTwoLegPatrolProgram,
  CorridorMergeEtiquette: createCorridorMergeProgram,
  EmergencyPath: createEmergencyPathProgram,
  EscortWithHazardAvoidance: createEscortWithHazardProgram,
} as const satisfies Record<string, () => GoalProgram>;

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

test.run();

