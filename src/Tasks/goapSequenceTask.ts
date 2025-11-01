import log from "loglevel";
import type Context from "../context";
import { ContextState } from "../contextState";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import type { WorldState } from "../context";
import CompoundTask, { type CompoundTaskChild } from "./compoundTask";
import PrimitiveTask from "./primitiveTask";

interface GoapNode {
  cost: number;
  world: WorldState;
  plan: PrimitiveTask[];
}

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

  return task.Children.length > 0;
};

const serializeWorld = (world: WorldState): string => {
  const keys = Object.keys(world).sort();
  return JSON.stringify(keys.map((key) => [key, world[key]]));
};

const snapshotWorldState = (context: Context): WorldState => {
  const keys = new Set<string>(Object.keys(context.WorldState));

  if (context.WorldStateChangeStack) {
    for (const key of Object.keys(context.WorldStateChangeStack)) {
      keys.add(key);
    }
  }

  const snapshot: WorldState = {};

  for (const key of keys) {
    snapshot[key] = context.getState(key);
  }

  return snapshot;
};

const createVirtualContext = (baseContext: Context, world: WorldState): Context => {
  const virtual = Object.assign(Object.create(Object.getPrototypeOf(baseContext)), baseContext) as Context;

  virtual.WorldState = { ...world };
  virtual.WorldStateChangeStack = {};
  for (const key of Object.keys(world)) {
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

const isGoalSatisfied = (goal: Record<string, number>, world: WorldState): boolean => {
  for (const [key, value] of Object.entries(goal)) {
    if (world[key] !== value) {
      return false;
    }
  }

  return true;
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

  if (task.Children.length === 0) {
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

    for (const [childIndex, child] of task.Children.entries()) {
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

