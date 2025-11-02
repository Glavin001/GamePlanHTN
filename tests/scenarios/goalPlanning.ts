import { test } from "uvu";
import * as assert from "uvu/assert";

import Planner from "../../src/planner";
import Context from "../../src/context";
import TaskStatus, { type TaskStatusValue } from "../../src/taskStatus";
import Domain from "../../src/domain";
import CompoundTask from "../../src/Tasks/compoundTask";
import DomainBuilder from "../../src/domainBuilder";
import {
  DoInOrder,
  DoInParallel,
  Perform,
  WhileConditionHolds,
  withOperators,
  applyExecutingConditions,
  compileGoalProgram,
  type ExecutingConditionSpec,
  type GoalProgram,
  type GoalCompilationHandlers,
  type OperatorSpec,
} from "../../src/goalPlanning";

// --------------------------------------------------------------------------------------
// Scenario-specific world model and navigation contracts
// --------------------------------------------------------------------------------------

interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const pose = (x: number, y: number, z = 0): Pose => ({ x, y, z });

const offsetPose = (source: Pose, dx: number, dy: number, dz = 0): Pose =>
  pose(source.x + dx, source.y + dy, source.z + dz);

interface ScenarioWorld {
  readonly now: number;
  advance(seconds: number): void;
  isInsideRegion(position: Pose, region: string): boolean;
  getEntityPose(entityId: string): Pose;
  distance(a: Pose, b: Pose): number;
  hasLineOfSight(observer: Pose, target: Pose, entityId: string): boolean;
}

interface ScenarioNavigationPlanner {
  hasCompliantPath(
    start: Pose,
    goalRegion: string | null,
    constraints: NavigationConstraints,
    deadlineSeconds: number | null,
  ): boolean;
  stepTowardRegion(start: Pose, goalRegion: string, constraints: NavigationConstraints): Pose | null;
  stepToFollow(start: Pose, target: Pose, radius: number, constraints: NavigationConstraints): Pose | null;
  stepToLeave(start: Pose, target: Pose, minimumDistance: number, constraints: NavigationConstraints): Pose | null;
}

const normalized = (dx: number, dy: number): { x: number; y: number } => {
  const length = Math.hypot(dx, dy);
  if (length < 1e-5) {
    return { x: 0, y: 0 };
  }
  return { x: dx / length, y: dy / length };
};

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

class DemoWorld implements ScenarioWorld {
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

class DemoNavigationPlanner implements ScenarioNavigationPlanner {
  constructor(private readonly world: ScenarioWorld) {}

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

// --------------------------------------------------------------------------------------
// Scenario context with scope utilities
// --------------------------------------------------------------------------------------

class NavigationConstraints {
  public readonly avoidRegions = new Set<string>();
  public keepWithinRegion: string | null = null;
  public maximumSpeedMetersPerSecond: number | null = null;
  public followEntityId: string | null = null;
  public followRadiusMeters: number | null = null;
  public leaveMinDistanceMeters: number | null = null;

  clone(): NavigationConstraints {
    const clone = new NavigationConstraints();
    clone.keepWithinRegion = this.keepWithinRegion;
    clone.maximumSpeedMetersPerSecond = this.maximumSpeedMetersPerSecond;
    clone.followEntityId = this.followEntityId;
    clone.followRadiusMeters = this.followRadiusMeters;
    clone.leaveMinDistanceMeters = this.leaveMinDistanceMeters;
    for (const region of this.avoidRegions) {
      clone.avoidRegions.add(region);
    }
    return clone;
  }

  mergeIn(other: NavigationConstraints): NavigationConstraints {
    const merged = this.clone();
    for (const region of other.avoidRegions) {
      merged.avoidRegions.add(region);
    }

    if (other.keepWithinRegion) {
      merged.keepWithinRegion = other.keepWithinRegion;
    }

    if (typeof other.maximumSpeedMetersPerSecond === "number") {
      merged.maximumSpeedMetersPerSecond = other.maximumSpeedMetersPerSecond;
    }

    if (other.followEntityId) {
      merged.followEntityId = other.followEntityId;
    }

    if (typeof other.followRadiusMeters === "number") {
      merged.followRadiusMeters = other.followRadiusMeters;
    }

    if (typeof other.leaveMinDistanceMeters === "number") {
      merged.leaveMinDistanceMeters = other.leaveMinDistanceMeters;
    }

    return merged;
  }
}

interface DeadlineScope {
  readonly startSeconds: number;
  readonly deadlineSeconds: number;
}

interface MinimumRunScope {
  readonly startSeconds: number;
  readonly minimumRunSeconds: number;
}

class ScenarioContext extends Context {
  public readonly world: ScenarioWorld;
  public readonly navigation: ScenarioNavigationPlanner;
  public robotPose: Pose = pose(0, 0, 0);
  public readonly messages: string[] = [];
  public programCompleted = false;

  private readonly constraintsStack: NavigationConstraints[] = [new NavigationConstraints()];
  private readonly deadlines: DeadlineScope[] = [];
  private readonly minimumRuns: MinimumRunScope[] = [];

  constructor(world: ScenarioWorld, navigation: ScenarioNavigationPlanner) {
    super();
    this.world = world;
    this.navigation = navigation;
  }

  get constraints(): NavigationConstraints {
    return this.constraintsStack[this.constraintsStack.length - 1];
  }

  pushConstraints(additional: NavigationConstraints): void {
    const merged = this.constraints.mergeIn(additional);
    this.constraintsStack.push(merged);
  }

  popConstraints(): void {
    if (this.constraintsStack.length > 1) {
      this.constraintsStack.pop();
    }
  }

  pushDeadline(deadlineSeconds: number): void {
    this.deadlines.push({ startSeconds: this.world.now, deadlineSeconds });
  }

  popDeadline(): void {
    this.deadlines.pop();
  }

  get currentDeadline(): DeadlineScope | null {
    return this.deadlines.length > 0 ? this.deadlines[this.deadlines.length - 1] : null;
  }

  pushMinimumRun(minimumRunSeconds: number): void {
    this.minimumRuns.push({ startSeconds: this.world.now, minimumRunSeconds });
  }

  popMinimumRun(): void {
    this.minimumRuns.pop();
  }

  get currentMinimumRun(): MinimumRunScope | null {
    return this.minimumRuns.length > 0 ? this.minimumRuns[this.minimumRuns.length - 1] : null;
  }

  completeProgram(): void {
    this.programCompleted = true;
    this.deadlines.length = 0;
    this.minimumRuns.length = 0;
    while (this.constraintsStack.length > 1) {
      this.constraintsStack.pop();
    }
  }

  logMessage(message: string): void {
    this.messages.push(message);
  }
}

// --------------------------------------------------------------------------------------
// Operator factories for scenario-specific scopes
// --------------------------------------------------------------------------------------

const createOperator = (
  name: string,
  operation: (context: ScenarioContext) => TaskStatusValue,
  options: Pick<OperatorSpec<ScenarioContext>, "forceStop" | "abort"> = {},
): OperatorSpec<ScenarioContext> => ({
  name,
  operation,
  ...options,
});

const seconds = (value: number): number => value;
const minutes = (value: number): number => value * 60;

const pushConstraints = (constraints: NavigationConstraints): OperatorSpec<ScenarioContext> =>
  createOperator("Push Constraints", (context) => {
    context.pushConstraints(constraints);
    return TaskStatus.Success;
  });

const popConstraints = createOperator("Pop Constraints", (context) => {
  context.popConstraints();
  return TaskStatus.Success;
});

const pushDeadline = (deadlineSeconds: number): OperatorSpec<ScenarioContext> =>
  createOperator("Push Deadline", (context) => {
    context.pushDeadline(deadlineSeconds);
    return TaskStatus.Success;
  });

const popDeadline = createOperator("Pop Deadline", (context) => {
  context.popDeadline();
  return TaskStatus.Success;
});

const pushMinimumRun = (minimumRunSeconds: number): OperatorSpec<ScenarioContext> =>
  createOperator("Push Minimum Run", (context) => {
    context.pushMinimumRun(minimumRunSeconds);
    return TaskStatus.Success;
  });

const popMinimumRun = createOperator("Pop Minimum Run", (context) => {
  context.popMinimumRun();
  return TaskStatus.Success;
});

// --------------------------------------------------------------------------------------
// Executing condition helpers
// --------------------------------------------------------------------------------------

const deadlineCondition = (): ExecutingConditionSpec<ScenarioContext> => ({
  name: "Deadline Window",
  predicate: (context) => {
    const deadline = context.currentDeadline;
    if (!deadline) {
      return true;
    }
    return context.world.now - deadline.startSeconds <= deadline.deadlineSeconds;
  },
});

const insideRegionCondition = (region: string): ExecutingConditionSpec<ScenarioContext> => ({
  name: `Stay inside ${region}`,
  predicate: (context) => context.world.isInsideRegion(context.robotPose, region),
});

const withinRadiusCondition = (entityId: string, radius: number): ExecutingConditionSpec<ScenarioContext> => ({
  name: `Within ${radius.toFixed(2)}m of ${entityId}`,
  predicate: (context) => {
    const distance = context.world.distance(context.robotPose, context.world.getEntityPose(entityId));
    if (distance <= radius * 1.2) {
      return true;
    }

    const minimumRun = context.currentMinimumRun;
    if (minimumRun) {
      const elapsed = context.world.now - minimumRun.startSeconds;
      if (elapsed < Math.max(3, radius * 3)) {
        return true;
      }
    }

    return false;
  },
});

const lineOfSightCondition = (entityId: string): ExecutingConditionSpec<ScenarioContext> => ({
  name: `Line of sight to ${entityId}`,
  predicate: (context) =>
    context.world.hasLineOfSight(context.robotPose, context.world.getEntityPose(entityId), entityId),
});

const distanceAtMostCondition = (entityId: string, distance: number): ExecutingConditionSpec<ScenarioContext> => ({
  name: `Distance to ${entityId} ≤ ${distance.toFixed(2)}`,
  predicate: (context) =>
    context.world.distance(context.robotPose, context.world.getEntityPose(entityId)) <= distance,
});

const distanceAtLeastCondition = (entityId: string, distance: number): ExecutingConditionSpec<ScenarioContext> => ({
  name: `Distance to ${entityId} ≥ ${distance.toFixed(2)}`,
  predicate: (context) =>
    context.world.distance(context.robotPose, context.world.getEntityPose(entityId)) >= distance,
});

// --------------------------------------------------------------------------------------
// Primitive operators for scenario actions
// --------------------------------------------------------------------------------------

const moveToRegionOperator = (region: string) => (context: ScenarioContext): TaskStatusValue => {
  const deadline = context.currentDeadline;
  if (deadline && context.world.now - deadline.startSeconds > deadline.deadlineSeconds) {
    return TaskStatus.Failure;
  }

  if (!context.navigation.hasCompliantPath(context.robotPose, region, context.constraints, deadline?.deadlineSeconds ?? null))
  {
    return TaskStatus.Failure;
  }

  if (context.world.isInsideRegion(context.robotPose, region)) {
    return TaskStatus.Success;
  }

  const nextPose = context.navigation.stepTowardRegion(context.robotPose, region, context.constraints);
  if (!nextPose) {
    return TaskStatus.Failure;
  }

  context.robotPose = nextPose;
  return TaskStatus.Continue;
};

const followEntityOperator = (entityId: string, radius: number) =>
  (context: ScenarioContext): TaskStatusValue => {
    const minimumRun = context.currentMinimumRun;
    if (minimumRun) {
      const elapsed = context.world.now - minimumRun.startSeconds;
      if (elapsed >= minimumRun.minimumRunSeconds) {
        return TaskStatus.Success;
      }
    }

    const target = context.world.getEntityPose(entityId);
    const nextPose = context.navigation.stepToFollow(context.robotPose, target, radius, context.constraints);
    if (!nextPose) {
      return TaskStatus.Failure;
    }

    context.robotPose = nextPose;
    return TaskStatus.Continue;
  };

const holdPositionOperator = (context: ScenarioContext): TaskStatusValue => {
  const minimumRun = context.currentMinimumRun;
  if (!minimumRun) {
    return TaskStatus.Success;
  }

  const elapsed = context.world.now - minimumRun.startSeconds;
  if (elapsed >= minimumRun.minimumRunSeconds) {
    return TaskStatus.Success;
  }

  return TaskStatus.Continue;
};

const moveAwayFromOperator = (entityId: string, distance: number) =>
  (context: ScenarioContext): TaskStatusValue => {
    const target = context.world.getEntityPose(entityId);
    if (context.world.distance(context.robotPose, target) >= distance) {
      return TaskStatus.Success;
    }

    const nextPose = context.navigation.stepToLeave(context.robotPose, target, distance, context.constraints);
    if (!nextPose) {
      return TaskStatus.Failure;
    }

    context.robotPose = nextPose;
    return TaskStatus.Continue;
  };

const speakOperator = (message: string) => (context: ScenarioContext): TaskStatusValue => {
  context.logMessage(message);
  return TaskStatus.Success;
};

const completeProgramOperator = (context: ScenarioContext): TaskStatusValue => {
  context.completeProgram();
  return TaskStatus.Success;
};

// --------------------------------------------------------------------------------------
// Scenario-specific goal node helpers
// --------------------------------------------------------------------------------------

const moveToRegion = (region: string): GoalProgram =>
  new Perform("moveToRegion", { region }, `Move To ${region}`);

const followEntity = (entityId: string, radius: number): GoalProgram =>
  new Perform("followEntity", { entityId, radius }, `Follow ${entityId}`);

const holdPosition = (duration: number): GoalProgram =>
  new Perform("holdPosition", { duration }, `Hold Position ${duration.toFixed(1)}s`);

const moveAwayFrom = (entityId: string, distance: number): GoalProgram =>
  new Perform("moveAwayFrom", { entityId, distance }, `Move Away From ${entityId}`);

const speak = (message: string): GoalProgram => new Perform("speak", { message }, `Speak '${message}'`);

const completeProgram = (): GoalProgram => new Perform("completeProgram", {}, "Mark Program Complete");

const applyNavigationConstraints = (
  constraints: NavigationConstraints,
  subgoal: GoalProgram,
): GoalProgram =>
  withOperators<ScenarioContext>("Apply Navigation Constraints", [pushConstraints(constraints)], subgoal, [popConstraints]);

const completeWithin = (deadlineSeconds: number, subgoal: GoalProgram): GoalProgram =>
  withOperators<ScenarioContext>("Complete Within Scope", [pushDeadline(deadlineSeconds)], subgoal, [popDeadline]);

const maintainForAtLeast = (minimumRunSeconds: number, subgoal: GoalProgram): GoalProgram =>
  withOperators<ScenarioContext>("Maintain For At Least Scope", [pushMinimumRun(minimumRunSeconds)], subgoal, [popMinimumRun]);

const whileConditionHolds = (
  condition: ExecutingConditionSpec<ScenarioContext>,
  subgoal: GoalProgram,
): GoalProgram => new WhileConditionHolds<ScenarioContext>(condition, subgoal);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

// --------------------------------------------------------------------------------------
// Goal compiler handlers for scenario actions
// --------------------------------------------------------------------------------------

const scenarioHandlers: GoalCompilationHandlers<ScenarioContext> = {
  perform(
    builder: DomainBuilder<ScenarioContext>,
    action: Perform,
    executingConditions: ExecutingConditionSpec<ScenarioContext>[],
  ) {
    switch (action.action) {
      case "moveToRegion": {
        const { region } = action.payload as { region: string };
        builder.action(action.label ?? `Move To ${region}`)
          .do(moveToRegionOperator(region));
        applyExecutingConditions(builder, executingConditions.concat([deadlineCondition()]));
        builder.end();
        return;
      }
      case "followEntity": {
        const { entityId, radius } = action.payload as { entityId: string; radius: number };
        builder.action(action.label ?? `Follow ${entityId}`)
          .do(followEntityOperator(entityId, radius));
        applyExecutingConditions(builder, executingConditions.concat([withinRadiusCondition(entityId, radius)]));
        builder.end();
        return;
      }
      case "holdPosition": {
        builder.action(action.label ?? "Hold Position").do(holdPositionOperator);
        applyExecutingConditions(builder, executingConditions);
        builder.end();
        return;
      }
      case "moveAwayFrom": {
        const { entityId, distance } = action.payload as { entityId: string; distance: number };
        builder.action(action.label ?? `Move Away From ${entityId}`)
          .do(moveAwayFromOperator(entityId, distance));
        applyExecutingConditions(builder, executingConditions);
        builder.end();
        return;
      }
      case "speak": {
        const { message } = action.payload as { message: string };
        builder.action(action.label ?? "Speak").do(speakOperator(message));
        applyExecutingConditions(builder, executingConditions);
        builder.end();
        return;
      }
      case "completeProgram": {
        builder.action(action.label ?? "Complete Program").do(completeProgramOperator);
        applyExecutingConditions(builder, executingConditions);
        builder.end();
        return;
      }
      default:
        throw new Error(`Unhandled action: ${action.action}`);
    }
  },
};

// --------------------------------------------------------------------------------------
// Scenario programs using the generic goal planning API
// --------------------------------------------------------------------------------------

const createEnterThenDwellProgram = (): GoalProgram =>
  new DoInOrder([
    completeWithin(seconds(10), moveToRegion("stage_area")),
    maintainForAtLeast(seconds(5), holdPosition(seconds(5))),
    speak("Arrived and dwelled in stage area."),
    completeProgram(),
  ]);

const createFollowPauseLeaveProgram = (): GoalProgram =>
  new DoInOrder([
    maintainForAtLeast(seconds(10), followEntity("alice", 1)),
    maintainForAtLeast(seconds(5), holdPosition(seconds(5))),
    moveAwayFrom("alice", 3),
    speak("Done following Alice, now at a safe distance."),
    completeProgram(),
  ]);

const createEscortVipProgram = (): GoalProgram =>
  applyNavigationConstraints(
    (() => {
      const constraints = new NavigationConstraints();
      constraints.maximumSpeedMetersPerSecond = 1.2;
      constraints.avoidRegions.add("construction_zone");
      return constraints;
    })(),
    new DoInOrder([
      maintainForAtLeast(seconds(15), followEntity("vip_42", 1)),
      moveToRegion("lobby"),
      speak("VIP escorted to lobby."),
      completeProgram(),
    ]),
  );

const createCorridorWithGuideProgram = (): GoalProgram =>
  applyNavigationConstraints(
    (() => {
      const constraints = new NavigationConstraints();
      constraints.keepWithinRegion = "east_corridor";
      return constraints;
    })(),
    new DoInOrder([
      whileConditionHolds(lineOfSightCondition("guide_bot"), moveToRegion("dock_a")),
      maintainForAtLeast(seconds(10), holdPosition(seconds(10))),
      speak("Lost guide line-of-sight; waited at safe stop."),
      completeProgram(),
    ]),
  );

const createInspectWaypointsProgram = (): GoalProgram =>
  applyNavigationConstraints(
    (() => {
      const constraints = new NavigationConstraints();
      constraints.avoidRegions.add("kitchen");
      return constraints;
    })(),
    new DoInOrder([
      completeWithin(
        minutes(5),
        new DoInOrder([
          moveToRegion("w1"),
          moveToRegion("w2"),
          moveToRegion("w3"),
        ]),
      ),
      speak("All waypoints inspected."),
      completeProgram(),
    ]),
  );

const createEmergencyPathProgram = (): GoalProgram =>
  new DoInOrder([
    completeWithin(seconds(40), whileConditionHolds(lineOfSightCondition("beacon1"), moveToRegion("egress"))),
    maintainForAtLeast(seconds(2), holdPosition(seconds(2))),
    whileConditionHolds(lineOfSightCondition("beacon1"), moveToRegion("egress")),
    speak("Emergency path completed under deadline."),
    completeProgram(),
  ]);

const createCorridorMergeProgram = (): GoalProgram =>
  new DoInOrder([
    applyNavigationConstraints(
      (() => {
        const constraints = new NavigationConstraints();
        constraints.maximumSpeedMetersPerSecond = 0.7;
        return constraints;
      })(),
      whileConditionHolds(distanceAtMostCondition("alice", 2), moveToRegion("lobby")),
    ),
    applyNavigationConstraints(
      (() => {
        const constraints = new NavigationConstraints();
        constraints.maximumSpeedMetersPerSecond = 1.2;
        return constraints;
      })(),
      moveToRegion("lobby"),
    ),
    speak("Arrived with courteous pacing."),
    completeProgram(),
  ]);

const createEscortWithHazardProgram = (): GoalProgram =>
  applyNavigationConstraints(
    (() => {
      const constraints = new NavigationConstraints();
      constraints.avoidRegions.add("construction_zone");
      return constraints;
    })(),
    new DoInOrder([
      whileConditionHolds(
        lineOfSightCondition("vip_42"),
        maintainForAtLeast(seconds(18), followEntity("vip_42", 1)),
      ),
      maintainForAtLeast(seconds(5), holdPosition(seconds(5))),
      whileConditionHolds(lineOfSightCondition("vip_42"), moveToRegion("lobby")),
      speak("VIP escorted, hazards avoided."),
      completeProgram(),
    ]),
  );

const createTwoLegPatrolProgram = (): GoalProgram =>
  new DoInOrder([
    completeWithin(seconds(20), moveToRegion("w1")),
    maintainForAtLeast(seconds(5), holdPosition(seconds(5))),
    whileConditionHolds(distanceAtLeastCondition("player_7", 2), moveToRegion("w2")),
    maintainForAtLeast(seconds(5), holdPosition(seconds(5))),
    moveToRegion("egress"),
    speak("Patrol complete."),
    completeProgram(),
  ]);

// --------------------------------------------------------------------------------------
// Utilities for running planners in tests
// --------------------------------------------------------------------------------------

const examplePrograms = {
  EnterThenDwell: createEnterThenDwellProgram,
  FollowPauseLeave: createFollowPauseLeaveProgram,
  EscortVIP: createEscortVipProgram,
  CorridorWithGuide: createCorridorWithGuideProgram,
  InspectWaypoints: createInspectWaypointsProgram,
  EmergencyPath: createEmergencyPathProgram,
  CorridorMergeEtiquette: createCorridorMergeProgram,
  EscortWithHazardAvoidance: createEscortWithHazardProgram,
  TwoLegPatrol: createTwoLegPatrolProgram,
} as const satisfies Record<string, () => GoalProgram>;

type ScenarioKey = keyof typeof examplePrograms;

const EXPECTED_MESSAGES: Partial<Record<ScenarioKey, string>> = {
  EnterThenDwell: "Arrived and dwelled in stage area.",
  FollowPauseLeave: "Done following Alice, now at a safe distance.",
  EscortVIP: "VIP escorted to lobby.",
  CorridorWithGuide: "Lost guide line-of-sight; waited at safe stop.",
  InspectWaypoints: "All waypoints inspected.",
  EmergencyPath: "Emergency path completed under deadline.",
  CorridorMergeEtiquette: "Arrived with courteous pacing.",
  EscortWithHazardAvoidance: "VIP escorted, hazards avoided.",
  TwoLegPatrol: "Patrol complete.",
};

const runScenario = (name: ScenarioKey, maxTicks = 1500) => {
  const world = new DemoWorld();
  const navigation = new DemoNavigationPlanner(world);
  const context = new ScenarioContext(world, navigation);
  context.init();

  const programFactory = examplePrograms[name];
  const program = programFactory();
  const domain = compileGoalProgram<ScenarioContext>(name, program, scenarioHandlers);
  const planner = new Planner<ScenarioContext>();

  let ticks = 0;
  while (!context.programCompleted && ticks < maxTicks) {
    planner.tick(domain, context);
    world.advance(0.1);
    ticks += 1;
  }

  return { context, ticks };
};

// --------------------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------------------

test("goal planning scenarios complete", () => {
  for (const name of Object.keys(examplePrograms) as ScenarioKey[]) {
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
  const context = new ScenarioContext(world, navigation);
  context.init();

  const program = new DoInOrder([
    completeWithin(seconds(1), moveToRegion("egress")),
    completeProgram(),
  ]);

  const domain = compileGoalProgram<ScenarioContext>("ImpossibleDeadline", program, scenarioHandlers);
  const planner = new Planner<ScenarioContext>();

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
  const program = new DoInOrder([
    applyNavigationConstraints(constraints, speak("Constraint test")),
    completeProgram(),
  ]);

  const domain = compileGoalProgram<ScenarioContext>("ConstraintScope", program, scenarioHandlers);
  const names = collectTaskNames(domain);
  assert.ok(names.includes("Push Constraints"), "push action should be present");
  assert.ok(names.includes("Pop Constraints"), "pop action should be present");
});

test("while condition halts action when predicate fails", () => {
  const world = new DemoWorld();
  const navigation = new DemoNavigationPlanner(world);
  const context = new ScenarioContext(world, navigation);
  context.init();

  const program = new DoInOrder([
    whileConditionHolds(lineOfSightCondition("beacon1"), moveToRegion("dock_a")),
    speak("Guard fallback"),
    completeProgram(),
  ]);

  const domain = compileGoalProgram<ScenarioContext>("WhileGuard", program, scenarioHandlers);
  const planner = new Planner<ScenarioContext>();

  // Immediately invalidate line of sight to force early exit.
  world.advance(10);

  let ticks = 0;
  const maxTicks = 300;
  while (!context.programCompleted && ticks < maxTicks) {
    planner.tick(domain, context);
    world.advance(0.1);
    ticks += 1;
  }

  assert.ok(context.messages.includes("Guard fallback"), "fallback action should run after guard failure");
});

const collectTaskNames = (domain: Domain<ScenarioContext>): string[] => {
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

test.run();
