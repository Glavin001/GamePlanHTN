import log from "loglevel";
import type Context from "../context";
import type { WorldStateBase } from "../context";
import { ContextState } from "../contextState";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import CompoundTask, { type CompoundTaskChild } from "./compoundTask";
import PrimitiveTask from "./primitiveTask";

interface GoapNode<TContext extends Context<TWorldState>, TWorldState extends WorldStateBase> {
  cost: number;
  world: TWorldState;
  plan: PrimitiveTask<TContext>[];
}

const isGoapChild = <TContext extends Context<WorldStateBase>>(
  child: CompoundTaskChild<TContext>,
): child is PrimitiveTask<TContext> | CompoundTask<TContext> =>
  child instanceof PrimitiveTask || child instanceof CompoundTask;

const expandChild = <TContext extends Context<TWorldState>, TWorldState extends WorldStateBase>(
  context: TContext,
  current: GoapNode<TContext, TWorldState>,
  child: CompoundTaskChild<TContext>,
  childIndex: number,
): GoapNode<TContext, TWorldState> | null => {
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

const isValid = <TContext extends Context<TWorldState>, TWorldState extends WorldStateBase>(
  context: TContext,
  task: CompoundTask<TContext>,
): boolean => {
  if (task.defaultValidityTest(context, task) === false) {
    return false;
  }

  if (!task.Goal || Object.keys(task.Goal).length === 0) {
    return false;
  }

  return task.Children.length > 0 || task.getDynamicGenerators().length > 0;
};

const serializeWorld = <TWorldState extends WorldStateBase>(world: TWorldState): string => {
  const entriesSource = world as Record<string, unknown>;
  const keys = Object.keys(entriesSource).sort();

  try {
    return JSON.stringify(keys.map((key) => [key, entriesSource[key]]));
  } catch (error) {
    log.warn("GOAPSequence: failed to serialize world state deterministically, coercing values to strings.", error);
    return JSON.stringify(keys.map((key) => [key, String(entriesSource[key])]));
  }
};

const snapshotWorldState = <TContext extends Context<TWorldState>, TWorldState extends WorldStateBase>(
  context: TContext,
): TWorldState => {
  const snapshot = { ...context.WorldState } as TWorldState;

  const keys = new Set<string>(Object.keys(context.WorldState as Record<string, unknown>));

  if (context.WorldStateChangeStack) {
    for (const key of Object.keys(context.WorldStateChangeStack)) {
      keys.add(key);
    }
  }

  for (const key of keys) {
    const typedKey = key as keyof TWorldState & string;
    snapshot[typedKey] = context.getState(typedKey);
  }

  return snapshot;
};

const createVirtualContext = <TContext extends Context<TWorldState>, TWorldState extends WorldStateBase>(
  baseContext: TContext,
  world: TWorldState,
): TContext => {
  const virtual = Object.assign(Object.create(Object.getPrototypeOf(baseContext)), baseContext) as TContext;

  virtual.WorldState = { ...world } as TWorldState;
  virtual.WorldStateChangeStack = {} as typeof baseContext.WorldStateChangeStack;
  const stackKeys = new Set<string>([
    ...Object.keys(world as Record<string, unknown>),
    ...Object.keys(baseContext.WorldState as Record<string, unknown>),
    ...(baseContext.WorldStateChangeStack ? Object.keys(baseContext.WorldStateChangeStack) : []),
  ]);

  for (const key of stackKeys) {
    virtual.WorldStateChangeStack[key as keyof TWorldState & string] = [];
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

const isGoalSatisfied = <TWorldState extends WorldStateBase>(goal: Record<string, number>, world: TWorldState): boolean => {
  const worldRecord = world as Record<string, unknown>;

  for (const [key, value] of Object.entries(goal)) {
    const worldValue = worldRecord[key];

    if (typeof worldValue !== "number" || worldValue !== value) {
      return false;
    }
  }

  return true;
};

const collectDynamicChildren = <TContext extends Context<TWorldState>, TWorldState extends WorldStateBase>(
  task: CompoundTask<TContext>,
  baseContext: TContext,
  world: TWorldState,
): CompoundTaskChild<TContext>[] => {
  const generated: CompoundTaskChild<TContext>[] = [];

  for (const generator of task.getDynamicGenerators()) {
    const generatorContext = createVirtualContext(baseContext, world);
    let results: CompoundTaskChild<TContext>[] | readonly CompoundTaskChild<TContext>[];

    try {
      results = generator({ context: generatorContext }) ?? [];
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

const mergeChildren = <TContext extends Context<WorldStateBase>>(
  task: CompoundTask<TContext>,
  staticChildren: CompoundTaskChild<TContext>[],
  generated: CompoundTaskChild<TContext>[],
): CompoundTaskChild<TContext>[] => {
  const merged: CompoundTaskChild<TContext>[] = [];
  const seen = new Set<string>();

  const addChild = (child: CompoundTaskChild<TContext>): void => {
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

const decompose = <TContext extends Context<TWorldState>, TWorldState extends WorldStateBase>(
  context: TContext,
  _startIndex: number,
  task: CompoundTask<TContext>,
): PlanResult<TContext> => {
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

  const open: GoapNode<TContext, TWorldState>[] = [
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

