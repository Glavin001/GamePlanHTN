import Context, { type WorldStateBase } from "../context";

export type ConditionPredicate<TContext extends Context<WorldStateBase> = Context> = (context: TContext) => boolean;

class FuncCondition<TContext extends Context<WorldStateBase> = Context> {
  public readonly Name: string;

  private readonly predicate?: ConditionPredicate<TContext>;

  constructor(name: string, predicate?: ConditionPredicate<TContext>) {
    this.Name = name;
    this.predicate = predicate;
  }

  isValid(context?: Context | null): boolean {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    const result = this.predicate ? this.predicate(context as TContext) : false;

    if (context.LogDecomposition) {
      context.DecompositionLog?.push(`FuncCondition(${this.Name}) => ${result}`);
    }

    return result;
  }
}

export default FuncCondition;
