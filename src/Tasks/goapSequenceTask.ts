import log from "loglevel";
import type Context from "../context";
import { ContextState } from "../contextState";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import type { WorldStateBase } from "../context";
import CompoundTask, { type CompoundTaskChild } from "./compoundTask";
import PrimitiveTask from "./primitiveTask";

type SerializableWorldValue = string | number | boolean | null;

type GoapWorldState = Record<string, SerializableWorldValue>;

interface GoapNode {
  cost: number;
  world: GoapWorldState;
  plan: PrimitiveTask<Context>[];
}

const isGoapChild = (child: CompoundTaskChild): child is PrimitiveTask<Context> | CompoundTask<Context> => {
  return child instanceof PrimitiveTask || child instanceof CompoundTask;
};

const expandChild = (
  context: Context,
  current: GoapNode,
  child: CompoundTaskChild,
  childIndex: number,
): GoapNode | null => {
  const virtualContext = createVirtualContext(context, current.world);

  if (!child.isValid(virtualContext)) {
    return null;
  }

  if (child instanceof PrimitiveTask) {
    const edgeCost = child.getGoapCost(virtualContext);
    child.applyEffects(virtualContext);

    return {
      cost: current.cost + edgeCost,
      world: snapshotWorldState(virtualContext),
      plan: [...current.plan, child],
    };
  }

  if (child instanceof CompoundTask) {
    virtualContext.MethodTraversalRecord.push(childIndex);
    const compoundBaseCost = child.getGoapCost(virtualContext);

    const result = child.decompose(virtualContext, 0);

    if (result.status === DecompositionStatus.Rejected) {
      return null;
    }

    if (result.status === DecompositionStatus.Failed || result.plan.length === 0) {
      return null;
    }

    const nextWorld = snapshotWorldState(virtualContext);
    const costContext = createVirtualContext(context, current.world);
    let accumulatedCost = compoundBaseCost;

    for (const primitive of result.plan) {
      accumulatedCost += primitive.getGoapCost(costContext);
      primitive.applyEffects(costContext);
    }

    return {
      cost: current.cost + accumulatedCost,
      world: nextWorld,
      plan: [...current.plan, ...result.plan],
    };
  }

  return null;
};

const isValid = (context: Context, task: CompoundTask): boolean => {
  if (task.defaultValidityTest(context, task) === false) {
    return false;
  }

  if (!task.Goal || Object.keys(task.Goal).length === 0) {
    return false;
  }

  return task.Children.length > 0 || task.getDynamicGenerators().length > 0;
};

const serializeWorld = (world: GoapWorldState): string => {
  const keys = Object.keys(world).sort();
  return JSON.stringify(keys.map((key) => [key, world[key]]));
};

const normalizeWorldValue = (value: unknown): SerializableWorldValue => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  log.warn("GOAPSequence: encountered non-primitive world state value during snapshot.", value);

  try {
    return JSON.stringify(value);
  } catch (error) {
    log.warn("GOAPSequence: failed to serialize complex world state value, coercing to string.", error);
    return String(value);
  }
};

const snapshotWorldState = (context: Context): GoapWorldState => {
  const keys = new Set<string>(Object.keys(context.WorldState));

  if (context.WorldStateChangeStack) {
    for (const key of Object.keys(context.WorldStateChangeStack)) {
      keys.add(key);
    }
  }

  const snapshot: GoapWorldState = {} as GoapWorldState;

  for (const key of keys) {
    snapshot[key] = normalizeWorldValue(context.getState(key));
  }

  return snapshot;
};

const createVirtualContext = (baseContext: Context, world: GoapWorldState): Context => {
  const virtual = Object.assign(Object.create(Object.getPrototypeOf(baseContext)), baseContext) as Context;

  virtual.WorldState = { ...world } as WorldStateBase;
  virtual.WorldStateChangeStack = {};
  const stackKeys = new Set<string>([
    ...Object.keys(world),
    ...Object.keys(baseContext.WorldState),
    ...(baseContext.WorldStateChangeStack ? Object.keys(baseContext.WorldStateChangeStack) : []),
  ]);

  for (const key of stackKeys) {
    virtual.WorldStateChangeStack[key] = [];
  }

  virtual.ContextState = ContextState.Planning;
  virtual.PartialPlanQueue = [];
  virtual.MethodTraversalRecord = [...baseContext.MethodTraversalRecord];
  virtual.LastMTR = [...baseContext.LastMTR];

  if (baseContext.DebugMTR) {
    virtual.DebugMTR = true;
    virtual.MTRDebug = [...baseContext.MTRDebug];
    virtual.LastMTRDebug = [...baseContext.LastMTRDebug];
  } else {
    virtual.DebugMTR = false;
    virtual.MTRDebug = [];
    virtual.LastMTRDebug = [];
  }

  virtual.HasPausedPartialPlan = false;
  virtual.IsDirty = false;

  return virtual;
};

const isGoalSatisfied = (goal: Record<string, number>, world: GoapWorldState): boolean => {
  for (const [key, value] of Object.entries(goal)) {
    const worldValue = world[key];

    if (typeof worldValue !== "number" || worldValue !== value) {
      return false;
    }
  }

  return true;
};

const collectDynamicChildren = (
  task: CompoundTask,
  baseContext: Context,
  world: GoapWorldState,
): CompoundTaskChild<Context>[] => {
  const generated: CompoundTaskChild<Context>[] = [];

  for (const generator of task.getDynamicGenerators()) {
    const generatorContext = createVirtualContext(baseContext, world);
    let results: CompoundTaskChild<Context>[] | readonly CompoundTaskChild<Context>[];

    try {
      results = generator(generatorContext) ?? [];
    } catch (error) {
      log.warn(`GOAPSequence: dynamic generator on task ${task.Name} threw an error.`, error);
      continue;
    }

    for (const child of results) {
      if (isGoapChild(child)) {
        generated.push(child);
      }
    }
  }

  return generated;
};

const mergeChildren = (
  task: CompoundTask,
  staticChildren: CompoundTaskChild<Context>[],
  generated: CompoundTaskChild<Context>[],
): CompoundTaskChild<Context>[] => {
  const merged: CompoundTaskChild<Context>[] = [];
  const seen = new Set<string>();

  const addChild = (child: CompoundTaskChild<Context>): void => {
    if (!child || typeof child.Name !== "string") {
      return;
    }

    if (seen.has(child.Name)) {
      return;
    }

    seen.add(child.Name);
    child.Parent = task;
    merged.push(child);
  };

  for (const child of staticChildren) {
    if (isGoapChild(child)) {
      addChild(child);
    }
  }

  const sortedGenerated = [...generated].sort((a, b) => a.Name.localeCompare(b.Name));

  for (const child of sortedGenerated) {
    addChild(child);
  }

  return merged;
};

const decompose = (context: Context, _startIndex: number, task: CompoundTask): PlanResult => {
  if (!task.Goal) {
    if (context.LogDecomposition) {
      log.debug(`GOAPSequence.OnDecompose:Task ${task.Name} missing goal definition.`);
    }

    return {
      plan: [],
      status: DecompositionStatus.Failed,
    };
  }

  if (task.Children.length === 0 && task.getDynamicGenerators().length === 0) {
    if (context.LogDecomposition) {
      log.debug(`GOAPSequence.OnDecompose:No primitive children available.`);
    }

    return {
      plan: [],
      status: DecompositionStatus.Failed,
    };
  }

  const open: GoapNode[] = [
    {
      cost: 0,
      world: snapshotWorldState(context),
      plan: [],
    },
  ];

  const visited = new Map<string, number>();

  while (open.length > 0) {
    let lowestIndex = 0;

    for (let i = 1; i < open.length; i++) {
      if (open[i].cost < open[lowestIndex].cost) {
        lowestIndex = i;
      }
    }

    const current = open.splice(lowestIndex, 1)[0];
    const worldKey = serializeWorld(current.world);
    const bestKnown = visited.get(worldKey);

    if (typeof bestKnown !== "undefined" && bestKnown <= current.cost) {
      continue;
    }

    visited.set(worldKey, current.cost);

    if (isGoalSatisfied(task.Goal, current.world)) {
      if (context.MethodTraversalRecord.length === 0) {
        context.MethodTraversalRecord.push(0);
      }
      return {
        plan: current.plan,
        status: DecompositionStatus.Succeeded,
      };
    }

    const staticChildren = task.Children;
    const generatedChildren = collectDynamicChildren(task, context, current.world);
    const children = mergeChildren(task, staticChildren, generatedChildren);

    for (const [childIndex, child] of children.entries()) {
      const node = expandChild(context, current, child, childIndex);
      if (node) {
        open.push(node);
      }
    }
  }

  return {
    plan: [],
    status: DecompositionStatus.Failed,
  };
};

export { isValid, decompose };

