// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import log from "loglevel";
import type Context from "../context";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import type { TaskCondition, PrimitiveTaskOperator, PrimitiveTaskProps } from "./primitiveTask";
import PrimitiveTask from "./primitiveTask";
import * as SelectorTask from "./selectorTask";
import * as SequenceTask from "./sequenceTask";
import PausePlanTask from "./pausePlanTask";
import Slot from "./slot";

export type CompoundTaskType = "sequence" | "select";

export type CompoundTaskChild = CompoundTask | PrimitiveTask | PausePlanTask | Slot;

export interface CompoundTaskConfig {
  name: string;
  tasks?: Array<CompoundTaskChild | PrimitiveTaskProps | PrimitiveTaskOperator | CompoundTaskConfig>;
  type: CompoundTaskType;
  conditions?: TaskCondition[];
}

type ValidityTest = (context: Context, task: CompoundTask) => boolean;

type DecomposeHandler = (context: Context, startIndex: number, task: CompoundTask) => PlanResult;

class CompoundTask {
  public Conditions: TaskCondition[] = [];

  public Children: CompoundTaskChild[] = [];

  public Name: string;

  public Type: CompoundTaskType;

  public Parent?: CompoundTask;

  private validityTest: ValidityTest;

  private decomposeHandler: DecomposeHandler;

  constructor({ name, tasks, type, conditions }: CompoundTaskConfig) {
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

    if (type === "sequence") {
      this.validityTest = SequenceTask.isValid;
      this.decomposeHandler = SequenceTask.decompose;
    } else if (type === "select") {
      this.validityTest = SelectorTask.isValid;
      this.decomposeHandler = SelectorTask.decompose;
    }

    if (Array.isArray(conditions)) {
      this.Conditions = conditions;
    }
  }

  private normalizeChild(child: CompoundTaskChild | PrimitiveTaskProps | PrimitiveTaskOperator | CompoundTaskConfig): CompoundTaskChild {
    if (child instanceof PrimitiveTask || child instanceof CompoundTask || child instanceof PausePlanTask || child instanceof Slot) {
      return child;
    }

    if (typeof child === "function" || (typeof child === "object" && "operator" in child)) {
      return new PrimitiveTask(child as PrimitiveTaskProps);
    }

    return new CompoundTask(child as CompoundTaskConfig);
  }

  private defaultDecomposeHandler(_context: Context, _startIndex: number, task: CompoundTask = this): PlanResult {
    log.warn(`Compound task of ${task.Type} type (no decompose method) was decomposed! Task: ${task.Name}`);

    return { plan: [], status: DecompositionStatus.Rejected };
  }

  toJSON(): Record<string, unknown> {
    const json = { ...this } as Record<string, unknown>;

    if (json.Parent && typeof json.Parent === "object" && "Name" in json.Parent) {
      json.Parent = (json.Parent as { Name: string }).Name;
    } else {
      json.Parent = null;
    }

    return json;
  }

  isValid(context: Context): boolean {
    return this.validityTest(context, this);
  }

  defaultValidityTest(context: Context, task: CompoundTask = this): boolean {
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

  decompose(context: Context, startIndex: number): PlanResult {
    return this.decomposeHandler(context, startIndex, this);
  }

  addSubtask(subtask: CompoundTaskChild): this {
    this.Children.push(subtask);

    return this;
  }

  addCondition(condition: TaskCondition): this {
    this.Conditions.push(condition);

    return this;
  }
}

export default CompoundTask;
