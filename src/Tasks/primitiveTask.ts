import log from "loglevel";
import Context from "../context";
import Effect, { EffectDefinition } from "../effect";
import type { TaskStatusValue } from "../taskStatus";
import type CompoundTask from "./compoundTask";
import FuncCondition, { type ConditionPredicate } from "../conditions/funcCondition";
import FuncOperator from "../operators/funcOperator";

export type TaskCondition<TContext extends Context = Context> = (context: TContext) => boolean;
export type ConditionLike<TContext extends Context = Context> = TaskCondition<TContext> | FuncCondition;

export interface ExecutingCondition {
  Name: string;
  func: TaskCondition;
}

export type PrimitiveTaskOperatorFunction = (context: Context) => TaskStatusValue;
export type PrimitiveTaskOperator = PrimitiveTaskOperatorFunction | FuncOperator;

export interface PrimitiveTaskConfig {
  name: string;
  operator?: PrimitiveTaskOperator;
  conditions?: ConditionLike[];
  effects?: EffectDefinition[];
  stop?: (context: Context) => void;
  abort?: (context: Context) => void;
}

export type PrimitiveTaskProps = PrimitiveTaskConfig | PrimitiveTaskOperator;

const unwrapCondition = (condition: ConditionLike): TaskCondition => {
  if (condition instanceof FuncCondition) {
    return (context: Context) => condition.isValid(context);
  }

  return condition as ConditionPredicate;
};

class PrimitiveTask {
  public Name = "";

  public Conditions: TaskCondition[] = [];

  public Effects: Effect[] = [];

  public ExecutingConditions: ExecutingCondition[] = [];

  public Parent?: CompoundTask;

  public operator?: PrimitiveTaskOperatorFunction;

  private operatorSource?: PrimitiveTaskOperator;

  private stopAction?: (context: Context) => void;

  private abortAction?: (context: Context) => void;

  constructor(props: PrimitiveTaskProps) {
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
            this.Effects.push(effect);
          } else {
            this.Effects.push(new Effect(effect));
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

      if (this.Conditions[index](context) === false) {
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

  addCondition(condition: ConditionLike): this {
    this.Conditions.push(unwrapCondition(condition));

    return this;
  }

  addExecutingCondition(condition: ExecutingCondition | FuncCondition): this {
    if (condition instanceof FuncCondition) {
      this.ExecutingConditions.push({
        Name: condition.Name,
        func: (context: Context) => condition.isValid(context),
      });
    } else {
      this.ExecutingConditions.push(condition);
    }

    return this;
  }

  addEffect(effect: Effect | EffectDefinition): this {
    if (effect instanceof Effect) {
      this.Effects.push(effect);
    } else {
      this.Effects.push(new Effect(effect));
    }

    return this;
  }

  stop(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    // Stop and abort use the optional callbacks provided when configuring the operator.
    if (this.stopAction) {
      this.stopAction(context);
    }
  }

  abort(context?: Context | null): void {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    if (this.abortAction) {
      this.abortAction(context);
    }
  }

  setOperator(
    operator: PrimitiveTaskOperator | undefined,
    forceStop?: (context: Context) => void,
    abort?: (context: Context) => void,
  ): this {
    if (operator instanceof FuncOperator) {
      return this.setOperator(
        (context: Context) => operator.update(context),
        (context: Context) => operator.stop(context),
        (context: Context) => operator.abort(context),
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
