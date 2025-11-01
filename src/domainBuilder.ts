import Domain from "./domain";
import type Context from "./context";
import { type EffectTypeValue } from "./effectType";
import CompoundTask, { type CompoundTaskChild } from "./Tasks/compoundTask";
import PrimitiveTask, { type PrimitiveTaskOperator, type TaskCondition } from "./Tasks/primitiveTask";
import PausePlanTask from "./Tasks/pausePlanTask";
import Slot from "./Tasks/slot";
import Effect from "./effect";

type Pointer = CompoundTask | PrimitiveTask;

class DomainBuilder<TContext extends Context = Context> {
  private readonly domain: Domain;

  private pointers: Pointer[];

  constructor(name: string) {
    this.domain = new Domain({ name });
    this.pointers = [this.domain.Root];
  }

  get pointer(): Pointer {
    if (this.pointers.length === 0) {
      throw new Error("The domain has already been built and the builder can no longer be used.");
    }

    return this.pointers[this.pointers.length - 1];
  }

  build(): Domain {
    if (this.pointer !== this.domain.Root) {
      throw new Error(`The domain definition lacks one or more end() calls. Pointer is '${this.pointer.Name}', expected '${this.domain.Root.Name}'.`);
    }

    this.pointers = [];

    return this.domain;
  }

  end(): this {
    if (this.pointers.length <= 1) {
      throw new Error("Cannot end the root domain definition");
    }

    this.pointers.pop();

    return this;
  }

  select(name: string): this {
    return this.addCompoundTask(new CompoundTask({ name, type: "select" }));
  }

  sequence(name: string): this {
    return this.addCompoundTask(new CompoundTask({ name, type: "sequence" }));
  }

  utilitySelect(name: string): this {
    return this.addCompoundTask(new CompoundTask({ name, type: "utility_select" }));
  }

  goapSequence(name: string, goal: Record<string, number>): this {
    return this.addCompoundTask(new CompoundTask({ name, type: "goap_sequence", goal }));
  }

  compoundTask(task: CompoundTask): this {
    return this.addCompoundTask(task);
  }

  primitiveTask(task: PrimitiveTask): this {
    const parent = this.ensureCompoundPointer();
    this.domain.add(parent, task);
    this.pointers.push(task);

    return this;
  }

  action(name: string): this {
    const parent = this.ensureCompoundPointer();
    const task = new PrimitiveTask({ name });
    this.domain.add(parent, task);
    this.pointers.push(task);

    return this;
  }

  utility(score: (context: TContext) => number): this {
    const pointer = this.pointer;

    if (pointer instanceof PrimitiveTask) {
      pointer.setUtilityScore(score as unknown as (context: Context) => number);
    } else if (pointer instanceof CompoundTask) {
      pointer.setUtilityScore(score as unknown as (context: Context) => number);
    } else {
      throw new Error("Utility scores can only be assigned to tasks");
    }

    return this;
  }

  utilityAction(name: string, score: (context: TContext) => number): this {
    return this.action(name).utility(score);
  }

  goapAction(name: string, costFn?: (context: TContext) => number): this {
    this.action(name);

    if (typeof costFn === "function") {
      this.cost(costFn);
    }

    return this;
  }

  cost(costFn: (context: TContext) => number): this {
    const primitive = this.ensurePrimitivePointer();
    primitive.setGoapCost(costFn as unknown as (context: Context) => number);

    return this;
  }

  condition(_name: string, condition: TaskCondition<TContext>): this {
    this.pointer.addCondition(condition);

    return this;
  }

  executingCondition(name: string, condition: TaskCondition<TContext>): this {
    const primitive = this.ensurePrimitivePointer();
    primitive.addExecutingCondition({ Name: name, func: condition });

    return this;
  }

  do(
    operator: PrimitiveTaskOperator,
    forceStopAction?: (context: TContext) => void,
    abortAction?: (context: TContext) => void,
  ): this {
    const primitive = this.ensurePrimitivePointer();
    primitive.setOperator(
      operator,
      forceStopAction as unknown as (context: Context) => void,
      abortAction as unknown as (context: Context) => void,
    );

    return this;
  }

  effect(name: string, type: EffectTypeValue, action: (context: TContext, effectType: EffectTypeValue | null) => void): this {
    const primitive = this.ensurePrimitivePointer();
    primitive.addEffect(new Effect({ name, type, action: action as unknown as (context: Context, type: EffectTypeValue | null) => void }));

    return this;
  }

  splice(domain: Domain): this {
    const parent = this.ensureCompoundPointer();
    this.domain.add(parent, domain.Root as CompoundTaskChild);

    return this;
  }

  slot(slotId: number): this {
    const parent = this.ensureCompoundPointer();
    const slot = new Slot(slotId, `Slot ${slotId}`);
    this.domain.add(parent, slot);

    return this;
  }

  pausePlan(): this {
    const parent = this.ensureCompoundPointer();
    if (parent.Type !== "sequence") {
      throw new Error("Pause Plan tasks can only be added inside Sequence tasks");
    }

    const pause = new PausePlanTask({ name: "Pause Plan" });
    this.domain.add(parent, pause);

    return this;
  }

  private addCompoundTask(task: CompoundTask): this {
    const parent = this.ensureCompoundPointer();
    this.domain.add(parent, task);
    this.pointers.push(task);

    return this;
  }

  private ensureCompoundPointer(): CompoundTask {
    if (!(this.pointer instanceof CompoundTask)) {
      throw new Error("Pointer is not a compound task. Did you forget to call end()?");
    }

    return this.pointer;
  }

  private ensurePrimitivePointer(): PrimitiveTask {
    if (!(this.pointer instanceof PrimitiveTask)) {
      throw new Error("Pointer is not a primitive task. Did you forget to define an action?");
    }

    return this.pointer;
  }
}

export default DomainBuilder;
