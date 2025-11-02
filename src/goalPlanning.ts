import Domain from "./domain";
import DomainBuilder from "./domainBuilder";
import Context, { type WorldStateBase } from "./context";
import TaskStatus, { type TaskStatusValue } from "./taskStatus";

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const pose = (x: number, y: number, z = 0): Pose => ({ x, y, z });

export const offsetPose = (source: Pose, dx: number, dy: number, dz = 0): Pose =>
  pose(source.x + dx, source.y + dy, source.z + dz);

export interface GoalPlanningWorld {
  readonly now: number;
  advance(seconds: number): void;
  isInsideRegion(position: Pose, region: string): boolean;
  getEntityPose(entityId: string): Pose;
  distance(a: Pose, b: Pose): number;
  hasLineOfSight(observer: Pose, target: Pose, entityId: string): boolean;
}

export interface NavigationPlanner {
  hasCompliantPath(
    start: Pose,
    goalRegion: string | null,
    constraints: NavigationConstraints,
    deadlineSeconds: number | null,
  ): boolean;
  stepTowardRegion(
    start: Pose,
    goalRegion: string,
    constraints: NavigationConstraints,
  ): Pose | null;
  stepToFollow(
    start: Pose,
    target: Pose,
    radius: number,
    constraints: NavigationConstraints,
  ): Pose | null;
  stepToLeave(
    start: Pose,
    target: Pose,
    minimumDistance: number,
    constraints: NavigationConstraints,
  ): Pose | null;
}

export class NavigationConstraints {
  public readonly avoidRegions: Set<string> = new Set();
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

export interface DeadlineScope {
  readonly startSeconds: number;
  readonly deadlineSeconds: number;
}

export interface MinimumRunScope {
  readonly startSeconds: number;
  readonly minimumRunSeconds: number;
}

class TimingScopes {
  public readonly deadlines: DeadlineScope[] = [];
  public readonly minimumRuns: MinimumRunScope[] = [];

  get currentDeadline(): DeadlineScope | null {
    return this.deadlines.length > 0 ? this.deadlines[this.deadlines.length - 1] : null;
  }

  get currentMinimumRun(): MinimumRunScope | null {
    return this.minimumRuns.length > 0 ? this.minimumRuns[this.minimumRuns.length - 1] : null;
  }
}

export class GoalPlanningContext<
  TWorldState extends WorldStateBase = WorldStateBase,
> extends Context<TWorldState> {
  public readonly world: GoalPlanningWorld;
  public readonly navigation: NavigationPlanner;
  public robotPose: Pose = pose(0, 0, 0);
  public readonly timeScopes = new TimingScopes();
  public programCompleted = false;
  public readonly messages: string[] = [];

  private constraintsStack: NavigationConstraints[] = [new NavigationConstraints()];

  constructor(world: GoalPlanningWorld, navigation: NavigationPlanner, initialWorldState?: TWorldState) {
    super(initialWorldState);
    this.world = world;
    this.navigation = navigation;
  }

  get constraints(): NavigationConstraints {
    return this.constraintsStack[this.constraintsStack.length - 1];
  }

  get constraintDepth(): number {
    return this.constraintsStack.length;
  }

  pushConstraints(additional: NavigationConstraints): void {
    const snapshot = this.constraints.mergeIn(additional);
    this.constraintsStack.push(snapshot);
  }

  popConstraints(): void {
    if (this.constraintsStack.length <= 1) {
      return;
    }
    this.constraintsStack.pop();
  }

  pushDeadline(deadlineSeconds: number): void {
    this.timeScopes.deadlines.push({
      startSeconds: this.world.now,
      deadlineSeconds,
    });
  }

  popDeadline(): void {
    this.timeScopes.deadlines.pop();
  }

  pushMinimumRun(minimumRunSeconds: number): void {
    this.timeScopes.minimumRuns.push({
      startSeconds: this.world.now,
      minimumRunSeconds,
    });
  }

  popMinimumRun(): void {
    this.timeScopes.minimumRuns.pop();
  }

  completeProgram(): void {
    this.programCompleted = true;
    while (this.constraintsStack.length > 1) {
      this.constraintsStack.pop();
    }
    this.timeScopes.deadlines.length = 0;
    this.timeScopes.minimumRuns.length = 0;
  }

  logMessage(message: string): void {
    this.messages.push(message);
  }
}

interface ExecutingConditionSpec {
  readonly name: string;
  readonly predicate: (context: GoalPlanningContext) => boolean;
}

const deadlineCondition = (): ExecutingConditionSpec => ({
  name: "Deadline Window",
  predicate: (context: GoalPlanningContext) => {
    const current = context.timeScopes.currentDeadline;
    if (!current) {
      return true;
    }
    return context.world.now - current.startSeconds <= current.deadlineSeconds;
  },
});

const insideRegionCondition = (region: string): ExecutingConditionSpec => ({
  name: `Stay inside ${region}`,
  predicate: (context: GoalPlanningContext) => context.world.isInsideRegion(context.robotPose, region),
});

const withinRadiusCondition = (entityId: string, radius: number): ExecutingConditionSpec => ({
  name: `Within ${radius.toFixed(2)}m of ${entityId}`,
  predicate: (context: GoalPlanningContext) =>
    (() => {
      const distance = context.world.distance(context.robotPose, context.world.getEntityPose(entityId));
      if (distance <= radius * 1.2) {
        return true;
      }

      const minimumRun = context.timeScopes.currentMinimumRun;
      if (minimumRun) {
        const elapsed = context.world.now - minimumRun.startSeconds;
        if (elapsed < Math.max(3, radius * 3)) {
          return true;
        }
      }

      return false;
    })(),
});

const lineOfSightCondition = (entityId: string): ExecutingConditionSpec => ({
  name: `Line of sight to ${entityId}`,
  predicate: (context: GoalPlanningContext) =>
    context.world.hasLineOfSight(context.robotPose, context.world.getEntityPose(entityId), entityId),
});

const distanceAtMostCondition = (entityId: string, distance: number): ExecutingConditionSpec => ({
  name: `Distance to ${entityId} ≤ ${distance.toFixed(2)}`,
  predicate: (context: GoalPlanningContext) =>
    context.world.distance(context.robotPose, context.world.getEntityPose(entityId)) <= distance,
});

const distanceAtLeastCondition = (entityId: string, distance: number): ExecutingConditionSpec => ({
  name: `Distance to ${entityId} ≥ ${distance.toFixed(2)}`,
  predicate: (context: GoalPlanningContext) =>
    context.world.distance(context.robotPose, context.world.getEntityPose(entityId)) >= distance,
});

const pushConstraintsOperator = (constraints: NavigationConstraints) =>
  (context: GoalPlanningContext): TaskStatusValue => {
    context.pushConstraints(constraints);
    return TaskStatus.Success;
  };

const popConstraintsOperator = (context: GoalPlanningContext): TaskStatusValue => {
  context.popConstraints();
  return TaskStatus.Success;
};

const pushDeadlineOperator = (deadlineSeconds: number) => (context: GoalPlanningContext): TaskStatusValue => {
  context.pushDeadline(deadlineSeconds);
  return TaskStatus.Success;
};

const popDeadlineOperator = (context: GoalPlanningContext): TaskStatusValue => {
  context.popDeadline();
  return TaskStatus.Success;
};

const pushMinimumRunOperator = (minimumRunSeconds: number) => (
  context: GoalPlanningContext,
): TaskStatusValue => {
  context.pushMinimumRun(minimumRunSeconds);
  return TaskStatus.Success;
};

const popMinimumRunOperator = (context: GoalPlanningContext): TaskStatusValue => {
  context.popMinimumRun();
  return TaskStatus.Success;
};

const moveToRegionOperator = (region: string) => (context: GoalPlanningContext): TaskStatusValue => {
  const { navigation, world } = context;
  const deadline = context.timeScopes.currentDeadline;
  if (deadline) {
    const remaining = deadline.deadlineSeconds - (world.now - deadline.startSeconds);
    if (remaining < 0) {
      return TaskStatus.Failure;
    }
  }

  if (!navigation.hasCompliantPath(context.robotPose, region, context.constraints, deadline ? deadline.deadlineSeconds : null))
  {
    return TaskStatus.Failure;
  }

  if (world.isInsideRegion(context.robotPose, region)) {
    return TaskStatus.Success;
  }

  const nextPose = navigation.stepTowardRegion(context.robotPose, region, context.constraints);
  if (!nextPose) {
    return TaskStatus.Failure;
  }

  context.robotPose = nextPose;
  return TaskStatus.Continue;
};

const followEntityOperator = (entityId: string, radius: number) => (
  context: GoalPlanningContext,
): TaskStatusValue => {
  const { navigation, world } = context;
  const target = world.getEntityPose(entityId);
  const minimumRun = context.timeScopes.currentMinimumRun;

  if (minimumRun) {
    const elapsed = world.now - minimumRun.startSeconds;
    if (elapsed >= minimumRun.minimumRunSeconds) {
      return TaskStatus.Success;
    }
  }

  const nextPose = navigation.stepToFollow(context.robotPose, target, radius, context.constraints);
  if (!nextPose) {
    return TaskStatus.Failure;
  }

  context.robotPose = nextPose;
  return TaskStatus.Continue;
};

const holdPositionOperator = (context: GoalPlanningContext): TaskStatusValue => {
  const minimumRun = context.timeScopes.currentMinimumRun;
  if (!minimumRun) {
    return TaskStatus.Success;
  }

  const elapsed = context.world.now - minimumRun.startSeconds;
  if (elapsed >= minimumRun.minimumRunSeconds) {
    return TaskStatus.Success;
  }

  return TaskStatus.Continue;
};

const moveAwayFromOperator = (entityId: string, distance: number) => (
  context: GoalPlanningContext,
): TaskStatusValue => {
  const { navigation, world } = context;
  const target = world.getEntityPose(entityId);
  if (world.distance(context.robotPose, target) >= distance) {
    return TaskStatus.Success;
  }

  const nextPose = navigation.stepToLeave(context.robotPose, target, distance, context.constraints);
  if (!nextPose) {
    return TaskStatus.Failure;
  }

  context.robotPose = nextPose;
  return TaskStatus.Continue;
};

const speakOperator = (message: string) => (context: GoalPlanningContext): TaskStatusValue => {
  context.logMessage(message);
  return TaskStatus.Success;
};

const markCompletedOperator = (context: GoalPlanningContext): TaskStatusValue => {
  context.completeProgram();
  return TaskStatus.Success;
};

type GoalProgramNode =
  | DoInOrder
  | DoInParallel
  | MoveToRegion
  | FollowEntity
  | HoldPosition
  | MoveAwayFrom
  | SpeakMessage
  | CompleteWithin
  | MaintainForAtLeast
  | WhileConditionHolds
  | ApplyNavigationConstraints;

export abstract class GoalProgram {
  abstract readonly kind: GoalProgramNode["kind"];
}

export class DoInOrder extends GoalProgram {
  readonly kind = "doInOrder" as const;
  readonly steps: GoalProgram[];

  constructor(...steps: GoalProgram[]) {
    super();
    this.steps = steps;
  }
}

export class DoInParallel extends GoalProgram {
  readonly kind = "doInParallel" as const;
  readonly branches: GoalProgram[];

  constructor(...branches: GoalProgram[]) {
    super();
    this.branches = branches;
  }
}

export class MoveToRegion extends GoalProgram {
  readonly kind = "moveToRegion" as const;
  readonly region: string;

  constructor(region: string) {
    super();
    this.region = region;
  }
}

export class FollowEntity extends GoalProgram {
  readonly kind = "followEntity" as const;
  readonly entityId: string;
  readonly radiusMeters: number;

  constructor(entityId: string, radiusMeters: number) {
    super();
    this.entityId = entityId;
    this.radiusMeters = radiusMeters;
  }
}

export class HoldPosition extends GoalProgram {
  readonly kind = "holdPosition" as const;
  readonly durationSeconds: number;

  constructor(duration: number) {
    super();
    this.durationSeconds = duration;
  }
}

export class MoveAwayFrom extends GoalProgram {
  readonly kind = "moveAwayFrom" as const;
  readonly entityId: string;
  readonly minimumDistanceMeters: number;

  constructor(entityId: string, minimumDistanceMeters: number) {
    super();
    this.entityId = entityId;
    this.minimumDistanceMeters = minimumDistanceMeters;
  }
}

export class SpeakMessage extends GoalProgram {
  readonly kind = "speakMessage" as const;
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }
}

export class CompleteWithin extends GoalProgram {
  readonly kind = "completeWithin" as const;
  readonly deadlineSeconds: number;
  readonly subgoal: GoalProgram;

  constructor(deadlineSeconds: number, subgoal: GoalProgram) {
    super();
    this.deadlineSeconds = deadlineSeconds;
    this.subgoal = subgoal;
  }
}

export class MaintainForAtLeast extends GoalProgram {
  readonly kind = "maintainForAtLeast" as const;
  readonly durationSeconds: number;
  readonly subgoal: GoalProgram;

  constructor(durationSeconds: number, subgoal: GoalProgram) {
    super();
    this.durationSeconds = durationSeconds;
    this.subgoal = subgoal;
  }
}

export abstract class Condition {
  abstract readonly type:
    | "isInside"
    | "distanceAtMost"
    | "distanceAtLeast"
    | "lineOfSight";
}

export class IsInside extends Condition {
  readonly type = "isInside" as const;
  readonly region: string;

  constructor(region: string) {
    super();
    this.region = region;
  }
}

export class DistanceToAtMost extends Condition {
  readonly type = "distanceAtMost" as const;
  readonly entityId: string;
  readonly meters: number;

  constructor(entityId: string, meters: number) {
    super();
    this.entityId = entityId;
    this.meters = meters;
  }
}

export class DistanceToAtLeast extends Condition {
  readonly type = "distanceAtLeast" as const;
  readonly entityId: string;
  readonly meters: number;

  constructor(entityId: string, meters: number) {
    super();
    this.entityId = entityId;
    this.meters = meters;
  }
}

export class HasLineOfSightTo extends Condition {
  readonly type = "lineOfSight" as const;
  readonly entityId: string;

  constructor(entityId: string) {
    super();
    this.entityId = entityId;
  }
}

export class WhileConditionHolds extends GoalProgram {
  readonly kind = "whileConditionHolds" as const;
  readonly condition: Condition;
  readonly subgoal: GoalProgram;

  constructor(condition: Condition, subgoal: GoalProgram) {
    super();
    this.condition = condition;
    this.subgoal = subgoal;
  }
}

export class ApplyNavigationConstraints extends GoalProgram {
  readonly kind = "applyNavigationConstraints" as const;
  readonly constraints: NavigationConstraints;
  readonly subgoal: GoalProgram;

  constructor(constraints: NavigationConstraints, subgoal: GoalProgram) {
    super();
    this.constraints = constraints;
    this.subgoal = subgoal;
  }
}

type AnyConditionSpec = ExecutingConditionSpec;

const translateCondition = (condition: Condition): AnyConditionSpec => {
  if (condition instanceof IsInside) {
    return insideRegionCondition(condition.region);
  }

  if (condition instanceof DistanceToAtMost) {
    return distanceAtMostCondition(condition.entityId, condition.meters);
  }

  if (condition instanceof DistanceToAtLeast) {
    return distanceAtLeastCondition(condition.entityId, condition.meters);
  }

  if (condition instanceof HasLineOfSightTo) {
    return lineOfSightCondition(condition.entityId);
  }

  return {
    name: "Always True",
    predicate: () => true,
  };
};

const emitProgram = (
  builder: DomainBuilder<GoalPlanningContext>,
  program: GoalProgram,
  executingConditions: AnyConditionSpec[],
): void => {
  if (program instanceof DoInOrder) {
    builder.sequence("Do In Order");
    for (const step of program.steps) {
      emitProgram(builder, step, executingConditions);
    }
    builder.end();
    return;
  }

  if (program instanceof DoInParallel) {
    builder.sequence("Do In Parallel (Serialized)");
    for (const branch of program.branches) {
      emitProgram(builder, branch, executingConditions);
    }
    builder.end();
    return;
  }

  if (program instanceof MoveToRegion) {
    const deadline = deadlineCondition();
    builder.action(`Move To ${program.region}`).do(moveToRegionOperator(program.region)).executingCondition(
      deadline.name,
      deadline.predicate,
    );

    for (const condition of executingConditions) {
      builder.executingCondition(condition.name, condition.predicate);
    }

    builder.end();
    return;
  }

  if (program instanceof FollowEntity) {
    const radiusCondition = withinRadiusCondition(program.entityId, program.radiusMeters);
    builder
      .action(`Follow ${program.entityId}`)
      .do(followEntityOperator(program.entityId, program.radiusMeters))
      .executingCondition(radiusCondition.name, radiusCondition.predicate);

    for (const condition of executingConditions) {
      builder.executingCondition(condition.name, condition.predicate);
    }

    builder.end();
    return;
  }

  if (program instanceof HoldPosition) {
    builder.action(`Hold for ${program.durationSeconds.toFixed(1)}s`).do(holdPositionOperator);
    for (const condition of executingConditions) {
      builder.executingCondition(condition.name, condition.predicate);
    }
    builder.end();
    return;
  }

  if (program instanceof MoveAwayFrom) {
    builder
      .action(`Leave ${program.entityId}`)
      .do(moveAwayFromOperator(program.entityId, program.minimumDistanceMeters));
    for (const condition of executingConditions) {
      builder.executingCondition(condition.name, condition.predicate);
    }
    builder.end();
    return;
  }

  if (program instanceof SpeakMessage) {
    builder.action(`Speak: ${program.text}`).do(speakOperator(program.text));
    for (const condition of executingConditions) {
      builder.executingCondition(condition.name, condition.predicate);
    }
    builder.end();
    return;
  }

  if (program instanceof ApplyNavigationConstraints) {
    builder.sequence("Apply Navigation Constraints");
    builder.action("Push Constraints").do(pushConstraintsOperator(program.constraints)).end();
    emitProgram(builder, program.subgoal, executingConditions);
    builder.action("Pop Constraints").do(popConstraintsOperator).end();
    builder.end();
    return;
  }

  if (program instanceof CompleteWithin) {
    builder.sequence(`Complete Within ${program.deadlineSeconds.toFixed(1)}s`);
    builder.action("Push Deadline").do(pushDeadlineOperator(program.deadlineSeconds)).end();
    emitProgram(builder, program.subgoal, executingConditions);
    builder.action("Pop Deadline").do(popDeadlineOperator).end();
    builder.end();
    return;
  }

  if (program instanceof MaintainForAtLeast) {
    builder.sequence(`Maintain For ${program.durationSeconds.toFixed(1)}s`);
    builder.action("Push Minimum Run").do(pushMinimumRunOperator(program.durationSeconds)).end();
    emitProgram(builder, program.subgoal, executingConditions);
    builder.action("Pop Minimum Run").do(popMinimumRunOperator).end();
    builder.end();
    return;
  }

  if (program instanceof WhileConditionHolds) {
    const translated = translateCondition(program.condition);
    builder.select(`While ${translated.name}`);
    builder.sequence("While Body");
    builder
      .action("While Condition Guard")
      .do((context: GoalPlanningContext) =>
        translated.predicate(context) ? TaskStatus.Success : TaskStatus.Failure,
      )
      .end();
    emitProgram(builder, program.subgoal, [...executingConditions, translated]);
    builder.end();
    builder.action("While Condition Skipped").do(() => TaskStatus.Success).end();
    builder.end();
    return;
  }

  throw new Error(`Unsupported goal program node: ${(program as GoalProgram).kind}`);
};

export const compileGoalProgram = (name: string, program: GoalProgram): Domain<GoalPlanningContext> => {
  const builder = new DomainBuilder<GoalPlanningContext>(name);
  builder.sequence("Goal Program");
  emitProgram(builder, program, []);
  builder.action("Mark Program Completed").do(markCompletedOperator).end();
  builder.end();
  return builder.build();
};

export const also = <T>(value: T, mutate: (value: T) => void): T => {
  mutate(value);
  return value;
};

export const seconds = (value: number): number => value;
export const minutes = (value: number): number => value * 60;

