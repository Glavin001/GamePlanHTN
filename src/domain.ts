// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import log from "loglevel";
import Context from "./context";
import type { PartialPlanEntry } from "./context";
import CompoundTask, { type CompoundTaskConfig, type CompoundTaskChild } from "./Tasks/compoundTask";
import PrimitiveTask, { type PrimitiveTaskOperator, type PrimitiveTaskProps } from "./Tasks/primitiveTask";
import Slot from "./Tasks/slot";
import DecompositionStatus from "./decompositionStatus";
import { ContextState } from "./contextState";
import type { PlanResult } from "./types";

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
  public readonly Name: string;

  public readonly Tasks: (CompoundTask | PrimitiveTask)[] = [];

  public readonly Root: CompoundTask;

  private slots: Map<number, Slot> | null = null;

  constructor({ name, tasks = [] }: DomainOptions) {
    this.Name = name;

    tasks.forEach((task) => {
      this.Tasks.push(this.normalizeTask(task));
    });

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

  // eslint-disable-next-line max-statements, complexity -- Mirrors FluidHTN structure
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

    context.ContextState = ContextState.Planning;

    let result: DomainPlanResult = { status: DecompositionStatus.Rejected, plan: [] };

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

        if (context.HasPausedPartialPlan) {
          break;
        }
      }

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

      context.MethodTraversalRecord = [];
      if (context.DebugMTR) {
        context.MTRDebug = [];
      }

      result = this.Root.decompose(context, 0);
      if (context.LogDecomposition) {
        log.debug(`Domain.findPlan: result from decomposing ${JSON.stringify(result)}`);
      }

      if (lastPartialPlanQueue?.length && (
        result.status === DecompositionStatus.Rejected || result.status === DecompositionStatus.Failed
      )) {
        context.HasPausedPartialPlan = true;
        context.PartialPlanQueue = lastPartialPlanQueue.map((entry) => ({ ...entry }));
      }
    }

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
      for (const worldStateKey of Object.keys(context.WorldStateChangeStack)) {
        if (context.WorldStateChangeStack[worldStateKey]?.length) {
          context.WorldStateChangeStack[worldStateKey] = [];
        }
      }
    }

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

    if (typeof task === "function" || (typeof task === "object" && "operator" in task)) {
      return new PrimitiveTask(task as PrimitiveTaskProps);
    }

    return new CompoundTask(task as CompoundTaskConfig);
  }
}

export default Domain;
