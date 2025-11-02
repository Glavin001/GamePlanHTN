import log from "loglevel";
import type Context from "../context";
import type { WorldStateBase } from "../context";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import CompoundTask, { type CompoundTaskChild } from "./compoundTask";
import PrimitiveTask from "./primitiveTask";
import PausePlanTask from "./pausePlanTask";

const isValid = <TContext extends Context<WorldStateBase>>(context: TContext, task: CompoundTask<TContext>): boolean => {
  if (task.defaultValidityTest(context, task) === false) {
    return false;
  }

  // A sequence with 0 children is not valid
  if (task.getChildren(context).length === 0) {
    return false;
  }

  return true;
};

// TODO: Fix this (function currently exceeds max-params just like FluidHTN)
const onDecomposeCompoundTask = <TContext extends Context<WorldStateBase>>(
  context: TContext,
  childTask: CompoundTask<TContext>,
  taskIndex: number,
  oldStackDepth: Record<string, number>,
  plan: PrimitiveTask<TContext>[],
  task: CompoundTask<TContext>,
  children: CompoundTaskChild<TContext>[],
): PlanResult<TContext> => {
  if (context.LogDecomposition) {
    log.debug(`SequenceTask:OnDecomposeCompoundTask:Decomposing compound task: ${JSON.stringify(plan)}`);
  }
  const childResult = childTask.decompose(context, 0);

  // If result is null, that means the entire planning procedure should cancel.
  if (childResult.status === DecompositionStatus.Rejected) {
    context.trimToStackDepth(oldStackDepth);

    return { plan: [], status: DecompositionStatus.Rejected };
  }

  // If the decomposition failed
  if (childResult.status === DecompositionStatus.Failed) {
    context.trimToStackDepth(oldStackDepth);

    return { plan: [], status: DecompositionStatus.Failed };
  }

  // If we successfully decomposed our subtask, add the resulting plan to this plan
  plan.push(...childResult.plan);
  if (context.HasPausedPartialPlan) {
    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecomposeCompoundTask:Return partial plan at index ${taskIndex}!`);
    }

    if (taskIndex < children.length - 1) {
      context.PartialPlanQueue.push({
        task,
        taskIndex: taskIndex + 1,
      });
    }

    return {
      plan,
      status: DecompositionStatus.Partial,
    };
  }

  return { plan, status: DecompositionStatus.Succeeded };
};

// TODO: Fix this (function currently exceeds max-params just like FluidHTN)
const onDecomposeTask = <TContext extends Context<WorldStateBase>>(
  context: TContext,
  childTask: CompoundTaskChild<TContext>,
  taskIndex: number,
  oldStackDepth: Record<string, number>,
  plan: PrimitiveTask<TContext>[],
  task: CompoundTask<TContext>,
  children: CompoundTaskChild<TContext>[],
): PlanResult<TContext> => {
  // If the task we're evaluating is invalid, return the existing plan as the result
  if (!childTask.isValid(context)) {
    context.trimToStackDepth(oldStackDepth);

    return { plan: [], status: DecompositionStatus.Failed };
  }

  if (context.LogDecomposition) {
    log.debug(`Sequence.OnDecomposeTask: Child task is valid.`);
  }

  if (childTask instanceof CompoundTask) {
    return onDecomposeCompoundTask(context, childTask, taskIndex, oldStackDepth, plan, task, children);
  } else if (childTask instanceof PrimitiveTask) {
    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecomposeTask:Adding primitive task to plan: ${childTask.Name}`);
    }

    const primitive = childTask as PrimitiveTask<TContext>;
    primitive.applyEffects(context);
    plan.push(primitive);
  } else if (childTask instanceof PausePlanTask) {
    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecomposeTask:Return partial plan at index ${taskIndex}!`);
    }
    context.HasPausedPartialPlan = true;
    context.PartialPlanQueue.push({
      task,
      taskIndex: taskIndex + 1,
    });

    return {
      plan,
      status: DecompositionStatus.Partial,
    };
  }

  if (context.LogDecomposition) {
    log.debug(`Sequence.OnDecomposeTask: Returning plan ${JSON.stringify(plan)}.`);
  }

  return { plan, status: plan.length === 0 ? DecompositionStatus.Failed : DecompositionStatus.Succeeded };
};

// For a sequence task, all children need to successfully decompose
const decompose = <TContext extends Context<WorldStateBase>>(context: TContext, startIndex: number, task: CompoundTask<TContext>): PlanResult<TContext> => {
  let result: PlanResult<TContext> = {
    plan: [],
    status: DecompositionStatus.Rejected,
  };

  const oldStackDepth = context.getWorldStateChangeDepth();

  const children = task.getChildren(context);

  for (let index = startIndex; index < children.length; index++) {
    const childTask = children[index];

    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecompose:Task index: ${index}: ${childTask?.Name}`);
    }

    // Note: result and plan will be mutated by this function
    result = onDecomposeTask(context, childTask, index, oldStackDepth, result.plan, task, children);

    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecompose: Received Result: ${JSON.stringify(result)}`);
    }

    // If we cannot make a plan OR if any task failed, short circuit this for loop
    if (result.status === DecompositionStatus.Rejected ||
      result.status === DecompositionStatus.Failed ||
      result.status === DecompositionStatus.Partial) {
      return result;
    }
  }

  result.status = result.plan.length === 0 ? DecompositionStatus.Failed : DecompositionStatus.Succeeded;

  return result;
};

export { isValid, decompose };
