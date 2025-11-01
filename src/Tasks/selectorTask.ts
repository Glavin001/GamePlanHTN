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

  // A sequence with 0 children is not valid
  if (task.Children.length === 0) {
    return false;
  }

  return true;
};

const beatsLastMTR = (context: Context, taskIndex: number, currentDecompositionIndex: number): boolean => {
  // If the last plan's traversal record for this decomposition layer
  // has a smaller index than the current task index we're about to
  // decompose, then the new decomposition can't possibly beat the
  // running plan, so we cancel finding a new plan.
  if (context.LastMTR[currentDecompositionIndex] < taskIndex) {
    // But, if any of the earlier records beat the record in LastMTR, we're still good, as we're on a higher priority branch.
    // This ensures that a plan of [0,0,1] can beat [0,1,0], as earlier tasks have priority
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
  // We need to record the task index before we decompose the task,
  // so that the traversal record is set up in the right order.
  context.MethodTraversalRecord.push(taskIndex);

  const childResult = childTask.decompose(context, 0);

  // If status is rejected, that means the entire planning procedure should cancel.
  if (childResult.status === DecompositionStatus.Rejected) {
    return {
      plan: [],
      status: DecompositionStatus.Rejected,
    };
  }

  // If the decomposition failed return the existing plan
  if (childResult.status === DecompositionStatus.Failed) {
    context.MethodTraversalRecord.pop();

    return {
      plan,
      status: DecompositionStatus.Failed,
    };
  }

  // If we successfully decomposed our subtask, add the resulting plan to this plan
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

    // Note: result and plan will be mutated by this function
    result = onDecomposeTask(context, childTask, index, result.plan);

    // If we cannot make a plan OR if we completed a plan, short circuit this for loop
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
