import log from "loglevel";
import type Context from "../context";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult, SuccessorGenerator } from "../types";
import type { EffectDefinition } from "../effect";
import type { TaskCondition, PrimitiveTaskOperator, PrimitiveTaskProps } from "./primitiveTask";
import PrimitiveTask from "./primitiveTask";
import * as SelectorTask from "./selectorTask";
import * as SequenceTask from "./sequenceTask";
import * as UtilitySelectorTask from "./utilitySelectorTask";
import * as GoapSequenceTask from "./goapSequenceTask";
import PausePlanTask from "./pausePlanTask";
import Slot from "./slot";

export type CompoundTaskType = "sequence" | "select" | "utility_select" | "goap_sequence";

type AllTaskTypes<TContext extends Context> = CompoundTaskChild<TContext> | PrimitiveTaskProps<TContext> | PrimitiveTaskOperator<TContext> | CompoundTaskConfig<TContext>;

export type CompoundTaskChild<TContext extends Context = Context> =
  | CompoundTask<TContext>
  | PrimitiveTask<TContext>
  | PausePlanTask
  | Slot;

export interface CompoundTaskConfig<TContext extends Context = Context> {
  name: string;
  tasks?: Array<AllTaskTypes<TContext>>
    | AllTaskTypes<TContext>;
  type: CompoundTaskType;
  conditions?: TaskCondition<TContext>[];
  effects?: EffectDefinition<TContext>[];
  goal?: Record<string, number>;
}

type ValidityTest<TContext extends Context> = (context: TContext, task: CompoundTask<TContext>) => boolean;

type DecomposeHandler<TContext extends Context> = (context: TContext, startIndex: number, task: CompoundTask<TContext>) => PlanResult<TContext>;

class CompoundTask<TContext extends Context = Context> {
  public Conditions: TaskCondition<TContext>[] = [];

  public Children: CompoundTaskChild<TContext>[] = [];

  public Name: string;

  public Type: CompoundTaskType;

  public Parent?: CompoundTask<TContext>;

  private validityTest: ValidityTest<TContext>;

  private decomposeHandler: DecomposeHandler<TContext>;

  private utilityScore?: (context: TContext) => number;

  private goapCost?: (context: TContext) => number;

  public Goal?: Record<string, number>;

  private dynamicGenerators?: SuccessorGenerator<TContext>[];

  constructor({ name, tasks, type, conditions, goal }: CompoundTaskConfig<TContext>) {
    this.Name = name;
    this.Type = type;
    this.validityTest = this.defaultValidityTest.bind(this);
    this.decomposeHandler = this.defaultDecomposeHandler.bind(this);

    if (Array.isArray(tasks)) {
      tasks.forEach((task) => {
        this.Children.push(this.normalizeChild(task));
      });
    } else if (typeof tasks === "function") {
      this.Children.push(this.normalizeChild(tasks));
    }

    // For simple HTNs, we make sequence and selector default node types and wire everything up
    if (type === "sequence") {
      this.validityTest = SequenceTask.isValid as ValidityTest<TContext>;
      this.decomposeHandler = SequenceTask.decompose as DecomposeHandler<TContext>;
    } else if (type === "select") {
      this.validityTest = SelectorTask.isValid as ValidityTest<TContext>;
      this.decomposeHandler = SelectorTask.decompose as DecomposeHandler<TContext>;
    } else if (type === "utility_select") {
      this.validityTest = UtilitySelectorTask.isValid as ValidityTest<TContext>;
      this.decomposeHandler = UtilitySelectorTask.decompose as DecomposeHandler<TContext>;
    } else if (type === "goap_sequence") {
      this.validityTest = GoapSequenceTask.isValid as ValidityTest<TContext>;
      this.decomposeHandler = GoapSequenceTask.decompose as DecomposeHandler<TContext>;
      this.Goal = goal ? { ...goal } : undefined;
    }
    // TODO: This would be a point to allow for extensibility to allow folks to provide
    // their own 'isValid' function

    // Set the conditions array
    if (Array.isArray(conditions)) {
      this.Conditions = conditions;
    }
  }

  private normalizeChild(child: CompoundTaskChild<TContext> | PrimitiveTaskProps<TContext> | PrimitiveTaskOperator<TContext> | CompoundTaskConfig<TContext>): CompoundTaskChild<TContext> {
    if (child instanceof PrimitiveTask || child instanceof CompoundTask || child instanceof PausePlanTask || child instanceof Slot) {
      return child;
    }

    if (typeof child === "function" || (typeof child === "object" && "operator" in child)) {
      return new PrimitiveTask<TContext>(child as PrimitiveTaskProps<TContext>);
    }

    return new CompoundTask<TContext>(child as CompoundTaskConfig<TContext>);
  }

  private defaultDecomposeHandler(_context: TContext, _startIndex: number, task: CompoundTask<TContext> = this): PlanResult<TContext> {
    log.warn(`Compound task of ${task.Type} type (no decompose method) was decomposed! Task: ${task.Name}`);

    return { plan: [], status: DecompositionStatus.Rejected };
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

  isValid(context: TContext): boolean {
    return this.validityTest(context, this);
  }

  defaultValidityTest(context: TContext, task: CompoundTask<TContext> = this): boolean {
    // Evaluate every condition for this task
    // If any return false, the condition for this task is not valid
    for (let index = 0; index < task.Conditions.length; index++) {
      if (typeof task.Conditions[index] !== "function") {
        return false;
      }
      if (task.Conditions[index](context) === false) {
        return false;
      }
    }

    return true;
  }

  decompose(context: TContext, startIndex: number): PlanResult<TContext> {
    return this.decomposeHandler(context, startIndex, this);
  }

  addSubtask(subtask: CompoundTaskChild<TContext>): this {
    this.Children.push(subtask);

    return this;
  }

  addDynamicGenerator(generator: SuccessorGenerator<TContext>): this {
    if (!this.dynamicGenerators) {
      this.dynamicGenerators = [];
    }

    this.dynamicGenerators.push(generator);

    return this;
  }

  getDynamicGenerators(): SuccessorGenerator<TContext>[] {
    return this.dynamicGenerators ? [...this.dynamicGenerators] : [];
  }

  getChildren(context: TContext): CompoundTaskChild<TContext>[] {
    const seen = new Set<string>();
    const children: CompoundTaskChild<TContext>[] = [];

    const addChild = (child: CompoundTaskChild<TContext>): void => {
      if (!child || typeof child.Name !== "string") {
        return;
      }

      if (seen.has(child.Name)) {
        return;
      }

      seen.add(child.Name);
      child.Parent = this;
      children.push(child);
    };

    for (const child of this.Children) {
      addChild(child);
    }

    if (this.dynamicGenerators) {
      for (const generator of this.dynamicGenerators) {
        let generated: CompoundTaskChild<TContext>[] | readonly CompoundTaskChild<TContext>[];

        try {
          generated = generator({ context }) ?? [];
        } catch (error) {
          log.warn(`Compound task ${this.Name} dynamic generator threw an error.`, error);
          continue;
        }

        for (const child of generated) {
          if (
            child instanceof PrimitiveTask ||
            child instanceof CompoundTask ||
            child instanceof PausePlanTask ||
            child instanceof Slot
          ) {
            addChild(child);
          }
        }
      }
    }

    return children;
  }

  addCondition(condition: TaskCondition<TContext>): this {
    this.Conditions.push(condition);

    return this;
  }

  setUtilityScore(score?: (context: TContext) => number): this {
    this.utilityScore = score;

    return this;
  }

  getUtilityScore(context: TContext): number {
    if (typeof this.utilityScore === "function") {
      return this.utilityScore(context);
    }

    return 0;
  }

  setGoapCost(cost?: (context: TContext) => number): this {
    this.goapCost = cost;

    return this;
  }

  getGoapCost(context: TContext): number {
    if (typeof this.goapCost === "function") {
      return this.goapCost(context);
    }

    return 0;
  }
}

export default CompoundTask;
