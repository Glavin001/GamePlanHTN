import log from "loglevel";
import Context from "./context";
import type { PartialPlanEntry } from "./context";
import CompoundTask, { type CompoundTaskConfig, type CompoundTaskChild } from "./Tasks/compoundTask";
import PrimitiveTask, { type PrimitiveTaskOperator, type PrimitiveTaskProps } from "./Tasks/primitiveTask";
import Slot from "./Tasks/slot";
import DecompositionStatus from "./decompositionStatus";
import { ContextState } from "./contextState";
import type { PlanResult } from "./types";
import FuncOperator from "./operators/funcOperator";

export type DomainTaskDefinition =
  | CompoundTask
  | PrimitiveTask
  | CompoundTaskConfig
  | PrimitiveTaskProps
  | PrimitiveTaskOperator;

export interface DomainOptions {
  name: string;
  tasks?: DomainTaskDefinition[];
}

export interface DomainPlanResult extends PlanResult {}

class Domain {
  // TODO: Handle actions, conditions, and effects via name lookup as separate objects
  // (see domain test for example)
  public readonly Name: string;

  public readonly Tasks: (CompoundTask | PrimitiveTask)[] = [];

  public readonly Root: CompoundTask;

  private slots: Map<number, Slot> | null = null;

  constructor({ name, tasks = [] }: DomainOptions) {
    this.Name = name;

    tasks.forEach((task) => {
      this.Tasks.push(this.normalizeTask(task));
    });

    // Our root node is a simple 'selector' task across our list of available tasks
    // So planning is essentially decomposing our entire set of tasks
    this.Root = new CompoundTask({ name: "Root", tasks, type: "select" });
  }

  add(parentTask: CompoundTask, childTask: CompoundTaskChild): void {
    if (parentTask === childTask) {
      throw Error("Parent and child cannot be the same task!");
    }

    if (childTask instanceof Slot) {
      if (!this.slots) {
        this.slots = new Map();
      }
      if (this.slots.has(childTask.SlotId)) {
        throw new Error("This slot id already exists in the domain definition");
      }
      parentTask.addSubtask(childTask);
      childTask.Parent = parentTask;
      this.slots.set(childTask.SlotId, childTask);

      return;
    }

    parentTask.addSubtask(childTask);
    childTask.Parent = parentTask;
  }

  // TODO: Refactor into smaller methods
  // eslint-disable-next-line complexity -- Mirrors FluidHTN structure
  findPlan(context: Context): DomainPlanResult {
    if (!(context instanceof Context)) {
      throw new TypeError(`Domain received non-context object: ${JSON.stringify(context)}`);
    }

    if (!context.IsInitialized) {
      throw new Error("Context has not been initialized");
    }

    if (!context.MethodTraversalRecord) {
      throw new Error("We require the Method Traversal Record to have a valid instance.");
    }

    if (context.LogDecomposition) {
      log.debug(`Domain.findPlan: Starting planning.`);
    }

    // The context is now in planning
    context.ContextState = ContextState.Planning;

    let result: DomainPlanResult = { status: DecompositionStatus.Rejected, plan: [] };

    // We first check whether we have a stored start task. This is true
    // if we had a partial plan pause somewhere in our plan, and we now
    // want to continue where we left off.
    // If this is the case, we don't erase the MTR, but continue building it.
    // However, if we have a partial plan, but LastMTR is not 0, that means
    // that the partial plan is still running, but something triggered a replan.
    // When this happens, we have to plan from the domain root (we're not
    // continuing the current plan), so that we're open for other plans to replace
    // the running partial plan.
    if (context.HasPausedPartialPlan && context.LastMTR.length === 0) {
      if (context.LogDecomposition) {
        log.debug(`Domain.findPlan: Resuming partial plan with length ${context.PartialPlanQueue.length}`);
      }

      context.HasPausedPartialPlan = false;
      while (context.PartialPlanQueue.length > 0) {
        const kvp = context.PartialPlanQueue.shift();

        if (!kvp) {
          continue;
        }

        if (result.plan.length === 0) {
          const kvpStatus = kvp.task.decompose(context, kvp.taskIndex);

          result.status = kvpStatus.status;
          result.plan.push(...kvpStatus.plan);

          if (context.LogDecomposition) {
            log.debug(`Domain.findPlan:Length0:Result - ${JSON.stringify(result)}`);
          }
        } else {
          const kvpStatus = kvp.task.decompose(context, kvp.taskIndex);

          if (context.LogDecomposition) {
            log.debug(`Domain.findPlan:Result ${JSON.stringify(kvpStatus)}`);
          }
          result.status = kvpStatus.status;
          if (kvpStatus.status === DecompositionStatus.Succeeded || kvpStatus.status === DecompositionStatus.Partial) {
            result.plan.push(...kvpStatus.plan);
          }
        }

        // While continuing a partial plan, we might encounter
        // a new pause.
        if (context.HasPausedPartialPlan) {
          break;
        }
      }

      // If we failed to continue the paused partial plan,
      // then we have to start planning from the root.
      if (result.status === DecompositionStatus.Rejected || result.status === DecompositionStatus.Failed) {
        context.MethodTraversalRecord = [];
        if (context.DebugMTR) {
          context.MTRDebug = [];
        }

        result = this.Root.decompose(context, 0);
      }
    } else {
      let lastPartialPlanQueue: PartialPlanEntry[] | null = null;

      if (context.HasPausedPartialPlan) {
        context.HasPausedPartialPlan = false;
        lastPartialPlanQueue = context.PartialPlanQueue.map((entry) => ({ ...entry }));
        context.PartialPlanQueue = [];
      }

      // We only erase the MTR if we start from the root task of the domain.
      context.MethodTraversalRecord = [];
      if (context.DebugMTR) {
        context.MTRDebug = [];
      }

      result = this.Root.decompose(context, 0);
      if (context.LogDecomposition) {
        log.debug(`Domain.findPlan: result from decomposing ${JSON.stringify(result)}`);
      }

      // If we failed to find a new plan, we have to restore the old plan,
      // if it was a partial plan.
      if (lastPartialPlanQueue?.length && (
        result.status === DecompositionStatus.Rejected || result.status === DecompositionStatus.Failed
      )) {
        context.HasPausedPartialPlan = true;
        context.PartialPlanQueue = lastPartialPlanQueue.map((entry) => ({ ...entry }));
      }
    }

    // If this MTR equals the last MTR, then we need to double check whether we ended up
    // just finding the exact same plan. During decomposition each compound task can't check
    // for equality, only for less than, so this case needs to be treated after the fact.
    let isMTRsEqual = context.MethodTraversalRecord.length === context.LastMTR.length;

    if (isMTRsEqual) {
      for (let i = 0; i < context.MethodTraversalRecord.length; i++) {
        if (context.MethodTraversalRecord[i] < context.LastMTR[i]) {
          isMTRsEqual = false;
          break;
        }
      }

      if (isMTRsEqual) {
        result = {
          plan: [],
          status: DecompositionStatus.Rejected,
        };
      }
    }

    if (result.status === DecompositionStatus.Succeeded || result.status === DecompositionStatus.Partial) {
      // Trim away any plan-only or plan&execute effects from the world state change stack, that only
      // permanent effects on the world state remains now that the planning is done.
      context.trimForExecution();

      if (context.WorldStateChangeStack) {
        for (const worldStateKey of Object.keys(context.WorldStateChangeStack)) {
          const stack = context.WorldStateChangeStack[worldStateKey];

          if (stack?.length) {
            const stateChange = stack.pop();
            if (stateChange) {
              context.WorldState[worldStateKey] = stateChange.value;
            }
            context.WorldStateChangeStack[worldStateKey] = [];
          }
        }
      }
    } else if (context.WorldStateChangeStack) {
      // Clear away any changes that might have been applied to the stack
      // No changes should be made or tracked further when the plan failed.
      for (const worldStateKey of Object.keys(context.WorldStateChangeStack)) {
        if (context.WorldStateChangeStack[worldStateKey]?.length) {
          context.WorldStateChangeStack[worldStateKey] = [];
        }
      }
    }

    // The context is no longer in planning
    context.ContextState = ContextState.Executing;

    return result;
  }

  trySetSlotDomain(slotId: number, domain: Domain): boolean {
    const slot = this.slots?.get(slotId);
    if (!slot) {
      return false;
    }

    return slot.setSubtask(domain.Root);
  }

  clearSlot(slotId: number): void {
    const slot = this.slots?.get(slotId);
    slot?.clear();
  }

  private normalizeTask(task: DomainTaskDefinition): CompoundTask | PrimitiveTask {
    if (task instanceof PrimitiveTask || task instanceof CompoundTask) {
      return task;
    }

    if (typeof task === "function" || task instanceof FuncOperator || (typeof task === "object" && task !== null && "operator" in task)) {
      return new PrimitiveTask(task as PrimitiveTaskProps);
    }

    return new CompoundTask(task as CompoundTaskConfig);
  }
}

export default Domain;
