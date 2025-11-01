import log from "loglevel";
import Context, { type WorldStateBase } from "../context";
import Effect, { type EffectDefinition } from "../effect";
import type { TaskStatusValue } from "../taskStatus";
import type CompoundTask from "./compoundTask";
import FuncCondition from "../conditions/funcCondition";
import FuncOperator from "../operators/funcOperator";

export type TaskCondition<TContext extends Context<WorldStateBase> = Context> = (context: TContext) => boolean;
export type ConditionLike<TContext extends Context<WorldStateBase> = Context> = TaskCondition<TContext> | FuncCondition<TContext>;

export interface ExecutingCondition<TContext extends Context<WorldStateBase> = Context> {
  Name: string;
  func: TaskCondition<TContext>;
}

export type PrimitiveTaskOperatorFunction<TContext extends Context<WorldStateBase> = Context> = (context: TContext) => TaskStatusValue;
export type PrimitiveTaskOperator<TContext extends Context<WorldStateBase> = Context> = PrimitiveTaskOperatorFunction<TContext> | FuncOperator;

export interface PrimitiveTaskConfig<TContext extends Context<WorldStateBase> = Context> {
  name: string;
  operator?: PrimitiveTaskOperator<TContext>;
  conditions?: ConditionLike<TContext>[];
  effects?: EffectDefinition<TContext>[];
  stop?: (context: TContext) => void;
  abort?: (context: TContext) => void;
}

export type PrimitiveTaskProps<TContext extends Context<WorldStateBase> = Context> = PrimitiveTaskConfig<TContext> | PrimitiveTaskOperator<TContext>;

const unwrapCondition = <TContext extends Context<WorldStateBase>>(condition: ConditionLike<TContext>): TaskCondition<TContext> => {
  if (condition instanceof FuncCondition) {
    return (context: TContext) => condition.isValid(context);
  }

  return condition as TaskCondition<TContext>;
};

class PrimitiveTask<TContext extends Context<WorldStateBase> = Context> {
  public Name = "";

  public Conditions: TaskCondition<TContext>[] = [];

  public Effects: Effect<TContext>[] = [];

  public ExecutingConditions: ExecutingCondition<TContext>[] = [];

  public Parent?: CompoundTask<TContext>;

  public operator?: PrimitiveTaskOperatorFunction<TContext>;

  private operatorSource?: PrimitiveTaskOperator<TContext>;

  private stopAction?: (context: TContext) => void;

  private abortAction?: (context: TContext) => void;

  private utilityScore?: (context: TContext) => number;

  private goapCost?: (context: TContext) => number;

  constructor(props: PrimitiveTaskProps<TContext>) {
    // Process the operation, which can be either a raw function or an object containing an
    // operator field
    if (props instanceof FuncOperator || typeof props === "function") {
      this.setOperator(props);
    } else {
      // Complex objects have a number of things we need to pull from the object passed in
      this.Name = props.name;
      if (typeof props.operator !== "undefined") {
        this.setOperator(props.operator, props.stop, props.abort);
      } else {
        this.stopAction = props.stop;
        this.abortAction = props.abort;
      }

      // Conditions are simple functions that return true/false depending on the world state
      if (Array.isArray(props.conditions)) {
        this.Conditions = props.conditions.map((condition) => unwrapCondition(condition));
      }

      // Effects are more complex object than conditions, and can either be simple functions
      // or objects. The Effect class handles disambiguating this for us.
      if (Array.isArray(props.effects)) {
        props.effects.forEach((effect) => {
          if (effect instanceof Effect) {
            this.Effects.push(effect as Effect<TContext>);
          } else {
            this.Effects.push(new Effect<TContext>(effect));
          }
        });
      }
    }
  }

  toJSON(): Record<string, unknown> {
    // Clone the object to prevent modifying the original object
    const json = { ...this } as Record<string, unknown>;

    // Replace the parent object with its name
    if (json.Parent && typeof json.Parent === "object" && "Name" in json.Parent) {
      json.Parent = (json.Parent as { Name: string }).Name;
    } else {
      json.Parent = null;
    }

    return json;
  }

  isValid(context: Context): boolean {
    if (context.LogDecomposition) {
      log.debug(`PrimitiveTask.IsValid check`);
    }

    // Check each of our conditions for validity. If any of them are false, this task cannot be
    // valid
    for (let index = 0; index < this.Conditions.length; index++) {
      if (typeof this.Conditions[index] !== "function") {
        return false;
      }

      if (this.Conditions[index](context as TContext) === false) {
        return false;
      }
    }

    return true;
  }

  applyEffects(context: Context): void {
    this.Effects.forEach((effect) => {
      effect.apply(context);
    });
  }

  addCondition(condition: ConditionLike<TContext>): this {
    this.Conditions.push(unwrapCondition(condition));

    return this;
  }

  addExecutingCondition(condition: ExecutingCondition<TContext> | FuncCondition<TContext>): this {
    if (condition instanceof FuncCondition) {
      this.ExecutingConditions.push({
        Name: condition.Name,
        func: (context: TContext) => condition.isValid(context),
      });
    } else {
      this.ExecutingConditions.push(condition);
    }

    return this;
  }

  addEffect(effect: Effect<TContext> | EffectDefinition<TContext>): this {
    if (effect instanceof Effect) {
      this.Effects.push(effect as Effect<TContext>);
    } else {
      this.Effects.push(new Effect<TContext>(effect));
    }

    return this;
  }

  setUtilityScore(score?: (context: TContext) => number): this {
    this.utilityScore = score;

    return this;
  }

  getUtilityScore(context: Context): number {
    if (typeof this.utilityScore === "function") {
      return this.utilityScore(context as TContext);
    }

    return 0;
  }

  setGoapCost(cost?: (context: TContext) => number): this {
    this.goapCost = cost;

    return this;
  }

  getGoapCost(context: Context): number {
    if (typeof this.goapCost === "function") {
      return this.goapCost(context as TContext);
    }

    return 1;
  }

  stop(context?: TContext | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    // Stop and abort use the optional callbacks provided when configuring the operator.
    if (this.stopAction) {
      this.stopAction(context as TContext);
    }
  }

  abort(context?: TContext | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    if (this.abortAction) {
      this.abortAction(context as TContext);
    }
  }

  setOperator(
    operator: PrimitiveTaskOperator<TContext> | undefined,
    forceStop?: (context: TContext) => void,
    abort?: (context: TContext) => void,
  ): this {
    if (operator instanceof FuncOperator) {
      return this.setOperator(
        (context: TContext) => operator.update(context),
        (context: TContext) => operator.stop(context),
        (context: TContext) => operator.abort(context),
      );
    }

    if (this.operatorSource && operator && this.operatorSource !== operator) {
      throw new Error("A Primitive Task can only contain a single operator!");
    }

    if (operator) {
      this.operator = operator;
      this.operatorSource = operator;
    } else if (!this.operator) {
      this.operator = undefined;
      this.operatorSource = undefined;
    }

    if (typeof forceStop !== "undefined") {
      this.stopAction = forceStop;
    }

    if (typeof abort !== "undefined") {
      this.abortAction = abort;
    }

    return this;
  }
}

export default PrimitiveTask;
