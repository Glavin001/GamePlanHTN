// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import PrimitiveTask, { type ExecutingCondition } from "./Tasks/primitiveTask";
import TaskStatus, { type TaskStatusValue } from "./taskStatus";
import DecompositionStatus, { type DecompositionStatusValue } from "./decompositionStatus";
import EffectType from "./effectType";
import type Effect from "./effect";
import Domain from "./domain";
import Context from "./context";

export type PlannerTask = PrimitiveTask;

type Plan = PrimitiveTask[];

type TaskCondition = (context: Context) => boolean;

type PlannerCallback<TArgs extends unknown[]> = (...args: TArgs) => void;

class Planner {
  private currentTask: PrimitiveTask | null = null;

  private plan: Plan = [];

  private lastStatus?: TaskStatusValue;

  private newPlanCallback?: PlannerCallback<[Plan]>;

  private replacePlanCallback?: PlannerCallback<[Plan, PrimitiveTask | null, Plan]>;

  private newTaskCallback?: PlannerCallback<[PrimitiveTask]>;

  private newTaskConditionFailedCallback?: PlannerCallback<[PrimitiveTask, TaskCondition]>;

  private stopCurrentTaskCallback?: PlannerCallback<[PrimitiveTask]>;

  private currentTaskCompletedSuccessfullyCallback?: PlannerCallback<[PrimitiveTask]>;

  private applyEffectCallback?: PlannerCallback<[Effect]>;

  private currentTaskFailedCallback?: PlannerCallback<[PrimitiveTask]>;

  private currentTaskContinuesCallback?: PlannerCallback<[PrimitiveTask]>;

  private currentTaskExecutingConditionFailedCallback?: PlannerCallback<[PrimitiveTask, ExecutingCondition]>;

  get LastStatus(): TaskStatusValue | undefined {
    return this.lastStatus;
  }

  set LastStatus(status: TaskStatusValue | undefined) {
    this.lastStatus = status;
  }

  get onNewPlan(): PlannerCallback<[Plan]> | undefined {
    return this.newPlanCallback;
  }

  set onNewPlan(callback: PlannerCallback<[Plan]> | undefined) {
    this.newPlanCallback = callback;
  }

  get onReplacePlan(): PlannerCallback<[Plan, PrimitiveTask | null, Plan]> | undefined {
    return this.replacePlanCallback;
  }

  set onReplacePlan(callback: PlannerCallback<[Plan, PrimitiveTask | null, Plan]> | undefined) {
    this.replacePlanCallback = callback;
  }

  get onNewTask(): PlannerCallback<[PrimitiveTask]> | undefined {
    return this.newTaskCallback;
  }

  set onNewTask(callback: PlannerCallback<[PrimitiveTask]> | undefined) {
    this.newTaskCallback = callback;
  }

  get onNewTaskConditionFailed(): PlannerCallback<[PrimitiveTask, TaskCondition]> | undefined {
    return this.newTaskConditionFailedCallback;
  }

  set onNewTaskConditionFailed(callback: PlannerCallback<[PrimitiveTask, TaskCondition]> | undefined) {
    this.newTaskConditionFailedCallback = callback;
  }

  get onStopCurrentTask(): PlannerCallback<[PrimitiveTask]> | undefined {
    return this.stopCurrentTaskCallback;
  }

  set onStopCurrentTask(callback: PlannerCallback<[PrimitiveTask]> | undefined) {
    this.stopCurrentTaskCallback = callback;
  }

  get onCurrentTaskCompletedSuccessfully(): PlannerCallback<[PrimitiveTask]> | undefined {
    return this.currentTaskCompletedSuccessfullyCallback;
  }

  set onCurrentTaskCompletedSuccessfully(callback: PlannerCallback<[PrimitiveTask]> | undefined) {
    this.currentTaskCompletedSuccessfullyCallback = callback;
  }

  get onApplyEffect(): PlannerCallback<[Effect]> | undefined {
    return this.applyEffectCallback;
  }

  set onApplyEffect(callback: PlannerCallback<[Effect]> | undefined) {
    this.applyEffectCallback = callback;
  }

  get onCurrentTaskFailed(): PlannerCallback<[PrimitiveTask]> | undefined {
    return this.currentTaskFailedCallback;
  }

  set onCurrentTaskFailed(callback: PlannerCallback<[PrimitiveTask]> | undefined) {
    this.currentTaskFailedCallback = callback;
  }

  get onCurrentTaskContinues(): PlannerCallback<[PrimitiveTask]> | undefined {
    return this.currentTaskContinuesCallback;
  }

  set onCurrentTaskContinues(callback: PlannerCallback<[PrimitiveTask]> | undefined) {
    this.currentTaskContinuesCallback = callback;
  }

  get onCurrentTaskExecutingConditionFailed(): PlannerCallback<[PrimitiveTask, ExecutingCondition]> | undefined {
    return this.currentTaskExecutingConditionFailedCallback;
  }

  set onCurrentTaskExecutingConditionFailed(callback: PlannerCallback<[PrimitiveTask, ExecutingCondition]> | undefined) {
    this.currentTaskExecutingConditionFailedCallback = callback;
  }

  // eslint-disable-next-line max-statements, complexity -- This closely follows FluidHTN implementation
  tick(domain: Domain, ctx: Context, allowImmediateReplan = true): void {
    if (!ctx.IsInitialized) {
      throw new Error("Context was not initialized!");
    }

    let decompositionStatus: DecompositionStatusValue = DecompositionStatus.Failed;
    let isTryingToReplacePlan = false;

    if ((this.currentTask === null && this.plan.length === 0) || ctx.IsDirty) {
      let lastPartialPlanQueue: typeof ctx.PartialPlanQueue | null = null;

      const worldStateDirtyReplan = ctx.IsDirty;

      ctx.IsDirty = false;

      if (worldStateDirtyReplan && ctx.HasPausedPartialPlan) {
        ctx.HasPausedPartialPlan = false;
        lastPartialPlanQueue = [];
        while (ctx.PartialPlanQueue.length > 0) {
          const entry = ctx.PartialPlanQueue.shift();
          if (entry) {
            lastPartialPlanQueue.push(entry);
          }
        }

        ctx.shiftMTR();

        if (ctx.DebugMTR) {
          ctx.shiftMTRDebug();
        }
      }

      const result = domain.findPlan(ctx);

      decompositionStatus = result.status;
      const newPlan = result.plan;

      isTryingToReplacePlan = this.plan.length > 0;
      if (decompositionStatus === DecompositionStatus.Succeeded || decompositionStatus === DecompositionStatus.Partial) {
        if (this.onReplacePlan && (this.plan.length > 0 || this.currentTask)) {
          this.onReplacePlan(this.plan, this.currentTask, newPlan);
        } else if (this.onNewPlan && this.plan.length === 0) {
          this.onNewPlan(newPlan);
        }
        this.plan = [];

        this.plan.push(...newPlan);

        if (this.currentTask !== null && this.currentTask instanceof PrimitiveTask) {
          if (this.onStopCurrentTask) {
            this.onStopCurrentTask(this.currentTask);
          }
          this.currentTask.stop(ctx);
          this.currentTask = null;
        }

        if (ctx.MethodTraversalRecord !== null) {
          ctx.shiftMTR();

          if (ctx.DebugMTR) {
            ctx.shiftMTRDebug();
          }
        }
      } else if (lastPartialPlanQueue !== null) {
        ctx.HasPausedPartialPlan = true;

        ctx.clearPartialPlanQueue();
        while (lastPartialPlanQueue.length > 0) {
          const entry = lastPartialPlanQueue.shift();
          if (entry) {
            ctx.PartialPlanQueue.push(entry);
          }
        }

        if (ctx.LastMTR.length > 0) {
          ctx.restoreMTR();

          if (ctx.DebugMTR) {
            ctx.restoreMTRDebug();
          }
        }
      }
    }

    if (this.currentTask === null && this.plan.length > 0) {
      this.currentTask = this.plan.shift() ?? null;
      if (this.currentTask) {
        if (this.onNewTask) {
          this.onNewTask(this.currentTask);
        }

        for (let i = 0; i < this.currentTask.Conditions.length; i++) {
          if (this.currentTask.Conditions[i](ctx) === false) {
            if (this.onNewTaskConditionFailed) {
              this.onNewTaskConditionFailed(this.currentTask, this.currentTask.Conditions[i]);
            }
            this.currentTask = null;
            this.plan = [];
            ctx.clearLastMTR();
            if (ctx.DebugMTR) {
              ctx.clearLastMTRDebug();
            }
            ctx.HasPausedPartialPlan = false;
            ctx.clearPartialPlanQueue();
            ctx.IsDirty = false;

            return;
          }
        }
      }
    }

    if (this.currentTask) {
      if (this.currentTask instanceof PrimitiveTask) {
        if (this.currentTask.operator) {
          this.currentTask.ExecutingConditions.forEach((condition) => {
            if (!condition.func(ctx)) {
              if (this.onCurrentTaskExecutingConditionFailed) {
                this.onCurrentTaskExecutingConditionFailed(this.currentTask as PrimitiveTask, condition);
              }

              this.currentTask = null;
              this.plan = [];

              ctx.clearLastMTR();
              if (ctx.DebugMTR) {
                ctx.clearLastMTRDebug();
              }
              ctx.HasPausedPartialPlan = false;
              ctx.clearPartialPlanQueue();
              ctx.IsDirty = false;

              return;
            }
          });

          this.LastStatus = this.currentTask?.operator(ctx);

          if (this.LastStatus === TaskStatus.Success) {
            if (this.onCurrentTaskCompletedSuccessfully) {
              this.onCurrentTaskCompletedSuccessfully(this.currentTask);
            }

            this.currentTask.Effects.forEach((effect) => {
              if (effect.Type === EffectType.PlanAndExecute) {
                if (this.onApplyEffect) {
                  this.onApplyEffect(effect);
                }
                effect.apply(ctx);
              }
            });

            this.currentTask = null;
            if (this.plan.length === 0) {
              ctx.clearLastMTR();

              if (ctx.DebugMTR) {
                ctx.clearLastMTRDebug();
              }

              ctx.IsDirty = false;

              if (allowImmediateReplan) {
                this.tick(domain, ctx, false);
              }
            }
          } else if (this.LastStatus === TaskStatus.Failure) {
            if (this.onCurrentTaskFailed) {
              this.onCurrentTaskFailed(this.currentTask);
            }

            this.currentTask = null;
            this.plan = [];

            ctx.clearLastMTR();
            if (ctx.DebugMTR) {
              ctx.clearLastMTRDebug();
            }

            ctx.HasPausedPartialPlan = false;
            ctx.clearPartialPlanQueue();
            ctx.IsDirty = false;
          } else if (this.onCurrentTaskContinues) {
            this.onCurrentTaskContinues(this.currentTask);
          }
        } else {
          this.currentTask = null;
          this.LastStatus = TaskStatus.Failure;
        }
      }

      if (this.currentTask === null && this.plan.length === 0 && isTryingToReplacePlan === false &&
        (decompositionStatus === DecompositionStatus.Failed ||
          decompositionStatus === DecompositionStatus.Rejected)) {
        this.LastStatus = TaskStatus.Failure;
      }
    }
  }

  reset(ctx: Context): void {
    this.plan = [];

    if (this.currentTask !== null && this.currentTask instanceof PrimitiveTask) {
      this.currentTask.stop(ctx);
    }
    this.currentTask = null;
  }

  getPlan(): Plan {
    return this.plan;
  }

  getCurrentTask(): PrimitiveTask | null {
    return this.currentTask;
  }
}

export default Planner;
