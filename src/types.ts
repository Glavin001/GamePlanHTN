import type CompoundTask, { type CompoundTaskChild } from "./Tasks/compoundTask";
import type PrimitiveTask from "./Tasks/primitiveTask";
import type { DecompositionStatusValue } from "./decompositionStatus";
import type Context from "./context";
import type { WorldStateBase } from "./context";

export interface PlanResult<TContext extends Context<WorldStateBase> = Context> {
  plan: PrimitiveTask<TContext>[];
  status: DecompositionStatusValue;
}

export type SuccessorGenerator<TContext extends Context<WorldStateBase> = Context> = (
  context: TContext,
) => CompoundTaskChild<TContext>[] | readonly CompoundTaskChild<TContext>[];
