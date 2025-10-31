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

const onDecomposeCompoundTask = (context: Context, childTask: CompoundTask, taskIndex: number, plan: PrimitiveTask[]): PlanResult => {
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
      log.debug(`Selector.OnDecomposeCompoundTask:Return partial plan at index ${taskIndex}!`);
    }

    return {
      plan,
      status: DecompositionStatus.Partial,
    };
  }

  return {
    plan,
    status: plan.length === 0 ? DecompositionStatus.Failed : DecompositionStatus.Succeeded,
  };
};

const onDecomposeTask = (context: Context, childTask: CompoundTaskChild, taskIndex: number, plan: PrimitiveTask[]): PlanResult => {
  // If the task we're evaluating is invalid, return the existing plan as the result
  if (!childTask.isValid(context)) {
    if (context.LogDecomposition) {
      log.debug(`Selector.OnDecomposeTask:Failed:Task ${childTask.Name}.isValid returned false!`);
    }

    return {
      plan,
      status: DecompositionStatus.Failed,
    };
  }

  if (childTask instanceof CompoundTask) {
    return onDecomposeCompoundTask(context, childTask, taskIndex, plan);
  }

  if (childTask instanceof PrimitiveTask) {
    context.MethodTraversalRecord.push(taskIndex);
    if (context.LogDecomposition) {
      log.debug(`Selector.OnDecomposeTask:Pushed ${childTask.Name} to plan!`);
    }

    childTask.applyEffects(context);
    plan.push(childTask);
  }

  // TODO: Add support for slots
  const result: PlanResult = {
    plan,
    status: plan.length === 0 ? DecompositionStatus.Failed : DecompositionStatus.Succeeded,
  };

  if (context.LogDecomposition) {
    log.debug(`Selector.OnDecomposeTask:${result.status}!`);
  }

  return result;
};

// For a selector task, only one child needs to successfully decompose
const decompose = (context: Context, startIndex: number, task: CompoundTask): PlanResult => {
  let result: PlanResult = {
    plan: [],
    status: DecompositionStatus.Rejected,
  };

  for (let index = startIndex; index < task.Children.length; index++) {
    if (context.LogDecomposition) {
      log.debug(`Selector.OnDecompose:Task index: ${index}: ${task.Children[index].Name}`);
    }

    // When we plan, we need to improve upon the previous MTR
    if (context?.LastMTR.length > 0 && context.MethodTraversalRecord.length < context.LastMTR.length) {
      // If our current plan is shorter than our previous plan, check to make sure it's an actual
      // improvement. (Longer plans are not an improvement)
      const currentDecompositionIndex = context.MethodTraversalRecord.length;

      if (!beatsLastMTR(context, index, currentDecompositionIndex)) {
        context.MethodTraversalRecord.push(-1);
        if (context.DebugMTR) {
          context.MTRDebug.push(`REPLAN FAIL ${task.Children[index].Name}`);
        }

        if (context.LogDecomposition) {
          log.debug(
            `Selector.OnDecompose:Rejected:Index ${currentDecompositionIndex} is beat by last method traversal record!`,
          );
        }

        result = {
          plan: [],
          status: DecompositionStatus.Rejected,
        };

        return result;
      }
    }

    const childTask = task.Children[index];

    result = onDecomposeTask(context, childTask, index, result.plan);

    if (result.status === DecompositionStatus.Rejected ||
      result.status === DecompositionStatus.Succeeded ||
      result.status === DecompositionStatus.Partial) {
      return result;
    }
  }

  result.status = result.plan.length === 0 ? DecompositionStatus.Failed : DecompositionStatus.Succeeded;

  return result;
};

export { isValid, decompose };
