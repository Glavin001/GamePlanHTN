import Context, { type WorldStateBase } from "../context";
import TaskStatus, { type TaskStatusValue } from "../taskStatus";

export type OperatorUpdate<TContext extends Context<WorldStateBase> = Context> = (context: TContext) => TaskStatusValue;
export type OperatorSideEffect<TContext extends Context<WorldStateBase> = Context> = (context: TContext) => void;

class FuncOperator<TContext extends Context<WorldStateBase> = Context> {
  private readonly updateFn?: OperatorUpdate<TContext>;

  private readonly stopFn?: OperatorSideEffect<TContext>;

  private readonly abortFn?: OperatorSideEffect<TContext>;

  constructor(updateFn?: OperatorUpdate<TContext>, stopFn?: OperatorSideEffect<TContext>, abortFn?: OperatorSideEffect<TContext>) {
    this.updateFn = updateFn;
    this.stopFn = stopFn;
    this.abortFn = abortFn;
  }

  update(context?: Context | null): TaskStatusValue {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    if (!this.updateFn) {
      return TaskStatus.Failure;
    }

    return this.updateFn(context as TContext);
  }

  stop(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    this.stopFn?.(context as TContext);
  }

  abort(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    this.abortFn?.(context as TContext);
  }
}

export default FuncOperator;
