import Context from "../context";
import TaskStatus, { type TaskStatusValue } from "../taskStatus";

export type OperatorUpdate = (context: Context) => TaskStatusValue;
export type OperatorSideEffect = (context: Context) => void;

class FuncOperator {
  private readonly updateFn?: OperatorUpdate;

  private readonly stopFn?: OperatorSideEffect;

  private readonly abortFn?: OperatorSideEffect;

  constructor(updateFn?: OperatorUpdate, stopFn?: OperatorSideEffect, abortFn?: OperatorSideEffect) {
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

    return this.updateFn(context);
  }

  stop(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    this.stopFn?.(context);
  }

  abort(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    this.abortFn?.(context);
  }
}

export default FuncOperator;
