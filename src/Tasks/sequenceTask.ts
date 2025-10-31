import log from "loglevel";
import type Context from "../context";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import CompoundTask, { type CompoundTaskChild } from "./compoundTask";
import PrimitiveTask from "./primitiveTask";
import PausePlanTask from "./pausePlanTask";

const isValid = (context: Context, task: CompoundTask): boolean => {
  if (task.defaultValidityTest(context, task) === false) {
    return false;
  }

  if (task.Children.length === 0) {
    return false;
  }

  return true;
};

const onDecomposeCompoundTask = (
  context: Context,
  childTask: CompoundTask,
  taskIndex: number,
  oldStackDepth: Record<string, number>,
  plan: PrimitiveTask[],
  task: CompoundTask,
): PlanResult => {
  if (context.LogDecomposition) {
    log.debug(`SequenceTask:OnDecomposeCompoundTask:Decomposing compound task: ${JSON.stringify(plan)}`);
  }
  const childResult = childTask.decompose(context, 0);

  if (childResult.status === DecompositionStatus.Rejected) {
    context.trimToStackDepth(oldStackDepth);

    return { plan: [], status: DecompositionStatus.Rejected };
  }

  if (childResult.status === DecompositionStatus.Failed) {
    context.trimToStackDepth(oldStackDepth);

    return { plan: [], status: DecompositionStatus.Failed };
  }

  plan.push(...childResult.plan);
  if (context.HasPausedPartialPlan) {
    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecomposeCompoundTask:Return partial plan at index ${taskIndex}!`);
    }

    if (taskIndex < task.Children.length - 1) {
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

const onDecomposeTask = (
  context: Context,
  childTask: CompoundTaskChild,
  taskIndex: number,
  oldStackDepth: Record<string, number>,
  plan: PrimitiveTask[],
  task: CompoundTask,
): PlanResult => {
  if (!childTask.isValid(context)) {
    context.trimToStackDepth(oldStackDepth);

    return { plan: [], status: DecompositionStatus.Failed };
  }

  if (context.LogDecomposition) {
    log.debug(`Sequence.OnDecomposeTask: Child task is valid.`);
  }

  if (childTask instanceof CompoundTask) {
    return onDecomposeCompoundTask(context, childTask, taskIndex, oldStackDepth, plan, task);
  } else if (childTask instanceof PrimitiveTask) {
    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecomposeTask:Adding primitive task to plan: ${childTask.Name}`);
    }

    childTask.applyEffects(context);
    plan.push(childTask);
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

const decompose = (context: Context, startIndex: number, task: CompoundTask): PlanResult => {
  let result: PlanResult = {
    plan: [],
    status: DecompositionStatus.Rejected,
  };

  const oldStackDepth = context.getWorldStateChangeDepth();

  for (let index = startIndex; index < task.Children.length; index++) {
    const childTask = task.Children[index];

    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecompose:Task index: ${index}: ${childTask?.Name}`);
    }

    result = onDecomposeTask(context, childTask, index, oldStackDepth, result.plan, task);

    if (context.LogDecomposition) {
      log.debug(`Sequence.OnDecompose: Received Result: ${JSON.stringify(result)}`);
    }

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
