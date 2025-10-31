// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import log from "loglevel";
import type Context from "../context";
import Effect, { EffectDefinition } from "../effect";
import type { TaskStatusValue } from "../taskStatus";
import type CompoundTask from "./compoundTask";

export type TaskCondition = (context: Context) => boolean;

export interface ExecutingCondition {
  Name: string;
  func: TaskCondition;
}

export type PrimitiveTaskOperator = (context: Context) => TaskStatusValue;

export interface PrimitiveTaskConfig {
  name: string;
  operator?: PrimitiveTaskOperator;
  conditions?: TaskCondition[];
  effects?: EffectDefinition[];
}

export type PrimitiveTaskProps = PrimitiveTaskConfig | PrimitiveTaskOperator;

class PrimitiveTask {
  public Name = "";

  public Conditions: TaskCondition[] = [];

  public Effects: Effect[] = [];

  public ExecutingConditions: ExecutingCondition[] = [];

  public Parent?: CompoundTask;

  public operator?: PrimitiveTaskOperator;

  private stopAction?: (context: Context) => void;

  constructor(props: PrimitiveTaskProps) {
    if (typeof props === "function") {
      this.operator = props;
    } else {
      this.Name = props.name;
      this.operator = props.operator;

      if (Array.isArray(props.conditions)) {
        this.Conditions = props.conditions;
      }

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
    const json = { ...this } as Record<string, unknown>;

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

  addCondition(condition: TaskCondition): this {
    this.Conditions.push(condition);

    return this;
  }

  addExecutingCondition(condition: ExecutingCondition): this {
    this.ExecutingConditions.push(condition);

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

  stop(context?: Context): void {
    if (this.stopAction && context) {
      this.stopAction(context);
    }
  }

  setOperator(operator: PrimitiveTaskOperator, forceStop?: (context: Context) => void): this {
    this.operator = operator;
    this.stopAction = forceStop;

    return this;
  }
}

export default PrimitiveTask;
