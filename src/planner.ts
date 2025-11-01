import PrimitiveTask, { type ExecutingCondition } from "./Tasks/primitiveTask";
import TaskStatus, { type TaskStatusValue } from "./taskStatus";
import DecompositionStatus, { type DecompositionStatusValue } from "./decompositionStatus";
import EffectType from "./effectType";
import type Effect from "./effect";
import Domain from "./domain";
import Context, { type WorldStateBase } from "./context";

export type PlannerTask<TContext extends Context<WorldStateBase> = Context> = PrimitiveTask<TContext>;

type Plan<TContext extends Context<WorldStateBase>> = PrimitiveTask<TContext>[];

type TaskCondition<TContext extends Context<WorldStateBase>> = (context: TContext) => boolean;

type PlannerCallback<TArgs extends unknown[]> = (...args: TArgs) => void;

class Planner<TContext extends Context<WorldStateBase> = Context> {
  private currentTask: PrimitiveTask<TContext> | null = null;

  private plan: Plan<TContext> = [];

  private lastStatus?: TaskStatusValue;

  private newPlanCallback?: PlannerCallback<[Plan<TContext>]>;

  private replacePlanCallback?: PlannerCallback<[Plan<TContext>, PrimitiveTask<TContext> | null, Plan<TContext>]>;

  private newTaskCallback?: PlannerCallback<[PrimitiveTask<TContext>]>;

  private newTaskConditionFailedCallback?: PlannerCallback<[PrimitiveTask<TContext>, TaskCondition<TContext>]>;

  private stopCurrentTaskCallback?: PlannerCallback<[PrimitiveTask<TContext>]>;

  private currentTaskCompletedSuccessfullyCallback?: PlannerCallback<[PrimitiveTask<TContext>]>;

  private applyEffectCallback?: PlannerCallback<[Effect<TContext>]>;

  private currentTaskFailedCallback?: PlannerCallback<[PrimitiveTask<TContext>]>;

  private currentTaskContinuesCallback?: PlannerCallback<[PrimitiveTask<TContext>]>;

  private currentTaskExecutingConditionFailedCallback?: PlannerCallback<[PrimitiveTask<TContext>, ExecutingCondition<TContext>]>;

  // ========================================================= PROPERTIES
  get LastStatus(): TaskStatusValue | undefined {
    return this.lastStatus;
  }

  set LastStatus(status: TaskStatusValue | undefined) {
    this.lastStatus = status;
  }

  get onNewPlan(): PlannerCallback<[Plan<TContext>]> | undefined {
    return this.newPlanCallback;
  }

  set onNewPlan(callback: PlannerCallback<[Plan<TContext>]> | undefined) {
    this.newPlanCallback = callback;
  }

  get onReplacePlan(): PlannerCallback<[Plan<TContext>, PrimitiveTask<TContext> | null, Plan<TContext>]> | undefined {
    return this.replacePlanCallback;
  }

  set onReplacePlan(callback: PlannerCallback<[Plan<TContext>, PrimitiveTask<TContext> | null, Plan<TContext>]> | undefined) {
    this.replacePlanCallback = callback;
  }

  get onNewTask(): PlannerCallback<[PrimitiveTask<TContext>]> | undefined {
    return this.newTaskCallback;
  }

  set onNewTask(callback: PlannerCallback<[PrimitiveTask<TContext>]> | undefined) {
    this.newTaskCallback = callback;
  }

  get onNewTaskConditionFailed(): PlannerCallback<[PrimitiveTask<TContext>, TaskCondition<TContext>]> | undefined {
    return this.newTaskConditionFailedCallback;
  }

  set onNewTaskConditionFailed(callback: PlannerCallback<[PrimitiveTask<TContext>, TaskCondition<TContext>]> | undefined) {
    this.newTaskConditionFailedCallback = callback;
  }

  // ========================================================= CALLBACKS
  get onStopCurrentTask(): PlannerCallback<[PrimitiveTask<TContext>]> | undefined {
    return this.stopCurrentTaskCallback;
  }

  set onStopCurrentTask(callback: PlannerCallback<[PrimitiveTask<TContext>]> | undefined) {
    this.stopCurrentTaskCallback = callback;
  }

  get onCurrentTaskCompletedSuccessfully(): PlannerCallback<[PrimitiveTask<TContext>]> | undefined {
    return this.currentTaskCompletedSuccessfullyCallback;
  }

  set onCurrentTaskCompletedSuccessfully(callback: PlannerCallback<[PrimitiveTask<TContext>]> | undefined) {
    this.currentTaskCompletedSuccessfullyCallback = callback;
  }

  get onApplyEffect(): PlannerCallback<[Effect<TContext>]> | undefined {
    return this.applyEffectCallback;
  }

  set onApplyEffect(callback: PlannerCallback<[Effect<TContext>]> | undefined) {
    this.applyEffectCallback = callback;
  }

  get onCurrentTaskFailed(): PlannerCallback<[PrimitiveTask<TContext>]> | undefined {
    return this.currentTaskFailedCallback;
  }

  set onCurrentTaskFailed(callback: PlannerCallback<[PrimitiveTask<TContext>]> | undefined) {
    this.currentTaskFailedCallback = callback;
  }

  get onCurrentTaskContinues(): PlannerCallback<[PrimitiveTask<TContext>]> | undefined {
    return this.currentTaskContinuesCallback;
  }

  set onCurrentTaskContinues(callback: PlannerCallback<[PrimitiveTask<TContext>]> | undefined) {
    this.currentTaskContinuesCallback = callback;
  }

  get onCurrentTaskExecutingConditionFailed(): PlannerCallback<[PrimitiveTask<TContext>, ExecutingCondition<TContext>]> | undefined {
    return this.currentTaskExecutingConditionFailedCallback;
  }

  set onCurrentTaskExecutingConditionFailed(callback: PlannerCallback<[PrimitiveTask<TContext>, ExecutingCondition<TContext>]> | undefined) {
    this.currentTaskExecutingConditionFailedCallback = callback;
  }

  // eslint-disable-next-line complexity -- This closely follows FluidHTN implementation
  tick(domain: Domain<TContext>, ctx: TContext, allowImmediateReplan = true): void {
    if (!ctx.IsInitialized) {
      throw new Error("Context was not initialized!");
    }

    let decompositionStatus: DecompositionStatusValue = DecompositionStatus.Failed;
    let isTryingToReplacePlan = false;

    // Check whether state has changed or the current plan has finished running.
    // and if so, try to find a new plan.
    if ((this.currentTask === null && this.plan.length === 0) || ctx.IsDirty) {
      let lastPartialPlanQueue: typeof ctx.PartialPlanQueue | null = null;

      const worldStateDirtyReplan = ctx.IsDirty;

      ctx.IsDirty = false;

      if (worldStateDirtyReplan && ctx.HasPausedPartialPlan) {
        // If we're simply re-evaluating whether to replace the current plan because
        // some world state got dirt, then we do not intend to continue a partial plan
        // right now, but rather see whether the world state changed to a degree where
        // we should pursue a better plan. Thus, if this replan fails to find a better
        // plan, we have to add back the partial plan temps cached above.
        ctx.HasPausedPartialPlan = false;
        // NOTE: Deviates from FluidHTN, JS uses arrays for queues
        lastPartialPlanQueue = [];
        while (ctx.PartialPlanQueue.length > 0) {
          const entry = ctx.PartialPlanQueue.shift();
          if (entry) {
            lastPartialPlanQueue.push(entry);
          }
        }

        // We also need to ensure that the last mtr is up to date with the on-going MTR of the partial plan,
        // so that any new potential plan that is decomposing from the domain root has to beat the currently
        // running partial plan.
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

        if (this.currentTask !== null) {
          if (this.onStopCurrentTask) {
            this.onStopCurrentTask(this.currentTask);
          }
          this.currentTask.stop(ctx);
          this.currentTask = null;
        }

        // Copy the MTR into our LastMTR to represent the current plan's decomposition record
        // that must be beat to replace the plan.
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

        // TODO: Double check that we're defining rich enough Conditions so that when we pass them through they are
        // useful to our onNewTaskConditionFailed event
        for (let i = 0; i < this.currentTask.Conditions.length; i++) {
          // If a condition failed, then the plan failed to progress! A replan is required.
          if (this.currentTask.Conditions[i](ctx) === false) {
            if (this.onNewTaskConditionFailed) {
              this.onNewTaskConditionFailed(this.currentTask, this.currentTask.Conditions[i]);
            }

            this.abortCurrentTask(ctx);
            this.LastStatus = TaskStatus.Failure;

            return;
          }
        }
      }
    }

    if (this.currentTask) {
      if (this.currentTask.operator) {
        for (const condition of this.currentTask.ExecutingConditions) {
          // If a condition failed, then the plan failed to progress! A replan is required.
          if (!condition.func(ctx)) {
            if (this.onCurrentTaskExecutingConditionFailed) {
              this.onCurrentTaskExecutingConditionFailed(this.currentTask, condition);
            }

            this.abortCurrentTask(ctx);
            this.LastStatus = TaskStatus.Failure;

            if (allowImmediateReplan) {
              this.tick(domain, ctx, false);
            }

            return;
          }
        }

        this.LastStatus = this.currentTask.operator(ctx);

          // If the operation finished successfully, we set task to null so that we dequeue the next task in the plan the following tick.
          if (this.LastStatus === TaskStatus.Success) {
            if (this.onCurrentTaskCompletedSuccessfully) {
              this.onCurrentTaskCompletedSuccessfully(this.currentTask);
            }

            // All effects that is a result of running this task should be applied when the task is a success.
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
            // If the operation failed to finish, we need to fail the entire plan, so that we will replan the next tick.
            if (this.onCurrentTaskFailed) {
              this.onCurrentTaskFailed(this.currentTask);
            }

            this.abortCurrentTask(ctx);

            if (allowImmediateReplan) {
              this.tick(domain, ctx, false);
            }
          } else if (this.onCurrentTaskContinues) {
            // Otherwise the operation isn't done yet and need to continue.
            this.onCurrentTaskContinues(this.currentTask);
          }
      } else {
        // This should not really happen if a domain is set up properly.
        this.abortCurrentTask(ctx);
        this.LastStatus = TaskStatus.Failure;

        if (allowImmediateReplan) {
          this.tick(domain, ctx, false);
        }
      }

      if (this.currentTask === null && this.plan.length === 0 && isTryingToReplacePlan === false &&
        (decompositionStatus === DecompositionStatus.Failed ||
          decompositionStatus === DecompositionStatus.Rejected)) {
        this.LastStatus = TaskStatus.Failure;
      }
    }
  }

  reset(ctx: TContext): void {
    this.plan = [];

    if (this.currentTask !== null) {
      this.currentTask.stop(ctx);
    }
    this.currentTask = null;
  }

  private abortCurrentTask(ctx: TContext): void {
    if (this.currentTask) {
      this.currentTask.abort(ctx);
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
  }

  getPlan(): Plan<TContext> {
    return this.plan;
  }

  getCurrentTask(): PrimitiveTask<TContext> | null {
    return this.currentTask;
  }
}

export default Planner;
