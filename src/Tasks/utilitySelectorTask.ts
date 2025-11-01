import log from "loglevel";
import type Context from "../context";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import CompoundTask, { type CompoundTaskChild } from "./compoundTask";
import PrimitiveTask from "./primitiveTask";

const isValid = (context: Context, task: CompoundTask): boolean => {
  if (task.defaultValidityTest(context, task) === false) {
    return false;
  }

  if (task.Children.length === 0) {
    return false;
  }

  return true;
};

const beatsLastMTR = (context: Context, taskIndex: number, currentDecompositionIndex: number): boolean => {
  if (context.LastMTR[currentDecompositionIndex] < taskIndex) {
    for (let i = 0; i < context.MethodTraversalRecord.length; i++) {
      const diff = context.MethodTraversalRecord[i] - context.LastMTR[i];

      if (diff < 0) {
        return true;
      }
      if (diff > 0) {
        return false;
      }
    }

    return false;
  }

  return true;
};

const getUtilityScore = (context: Context, childTask: CompoundTaskChild): number => {
  if (childTask instanceof PrimitiveTask) {
    return childTask.getUtilityScore(context);
  }

  if (childTask instanceof CompoundTask) {
    return childTask.getUtilityScore(context);
  }

  return Number.NEGATIVE_INFINITY;
};

const decomposeSelectedTask = (
  context: Context,
  childTask: CompoundTaskChild,
  taskIndex: number,
  plan: PrimitiveTask[],
): PlanResult => {
  if (childTask instanceof CompoundTask) {
    context.MethodTraversalRecord.push(taskIndex);

    const childResult = childTask.decompose(context, 0);

    if (childResult.status === DecompositionStatus.Rejected) {
      return {
        plan: [],
        status: DecompositionStatus.Rejected,
      };
    }

    if (childResult.status === DecompositionStatus.Failed) {
      context.MethodTraversalRecord.pop();

      return {
        plan,
        status: DecompositionStatus.Failed,
      };
    }

    plan.push(...childResult.plan);

    if (context.HasPausedPartialPlan) {
      if (context.LogDecomposition) {
        log.debug(`UtilitySelector.OnDecomposeCompoundTask:Return partial plan at index ${taskIndex}!`);
      }

      return {
        plan,
        status: DecompositionStatus.Partial,
      };
    }

    return {
      plan,
      status: childResult.status,
    };
  }

  if (childTask instanceof PrimitiveTask) {
    context.MethodTraversalRecord.push(taskIndex);

    if (context.LogDecomposition) {
      log.debug(`UtilitySelector.OnDecomposeTask:Pushed ${childTask.Name} to plan!`);
    }

    childTask.applyEffects(context);
    plan.push(childTask);

    return {
      plan,
      status: DecompositionStatus.Succeeded,
    };
  }

  if (context.LogDecomposition) {
    log.debug(`UtilitySelector.OnDecomposeTask:Unsupported child type ${childTask.constructor.name}`);
  }

  return {
    plan,
    status: DecompositionStatus.Failed,
  };
};

const decompose = (context: Context, startIndex: number, task: CompoundTask): PlanResult => {
  let bestIndex = -1;
  let bestChild: CompoundTaskChild | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = startIndex; index < task.Children.length; index++) {
    if (context.LogDecomposition) {
      log.debug(`UtilitySelector.OnDecompose:Task index: ${index}: ${task.Children[index].Name}`);
    }

    if (context?.LastMTR.length > 0 && context.MethodTraversalRecord.length < context.LastMTR.length) {
      const currentDecompositionIndex = context.MethodTraversalRecord.length;

      if (!beatsLastMTR(context, index, currentDecompositionIndex)) {
        context.MethodTraversalRecord.push(-1);

        if (context.DebugMTR) {
          context.MTRDebug.push(`REPLAN FAIL ${task.Children[index].Name}`);
        }

        if (context.LogDecomposition) {
          log.debug(
            `UtilitySelector.OnDecompose:Rejected:Index ${currentDecompositionIndex} is beat by last method traversal record!`,
          );
        }

        return {
          plan: [],
          status: DecompositionStatus.Rejected,
        };
      }
    }

    const childTask = task.Children[index];

    if (!childTask.isValid(context)) {
      if (context.LogDecomposition) {
        log.debug(`UtilitySelector.OnDecomposeTask:Failed:Task ${childTask.Name}.isValid returned false!`);
      }

      continue;
    }

    const score = getUtilityScore(context, childTask);

    if (score > bestScore || (score === bestScore && bestChild === null)) {
      bestScore = score;
      bestChild = childTask;
      bestIndex = index;
    }
  }

  if (bestChild === null) {
    return {
      plan: [],
      status: DecompositionStatus.Failed,
    };
  }

  const resultPlan: PrimitiveTask[] = [];
  const result = decomposeSelectedTask(context, bestChild, bestIndex, resultPlan);

  if (context.LogDecomposition) {
    log.debug(`UtilitySelector.OnDecompose:Result ${JSON.stringify({
      status: result.status,
      planLength: result.plan.length,
    })}`);
  }

  return result;
};

export { isValid, decompose };

