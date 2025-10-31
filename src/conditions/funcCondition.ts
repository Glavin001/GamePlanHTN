// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

import Context from "../context";

export type ConditionPredicate = (context: Context) => boolean;

class FuncCondition {
  public readonly Name: string;

  private readonly predicate?: ConditionPredicate;

  constructor(name: string, predicate?: ConditionPredicate) {
    this.Name = name;
    this.predicate = predicate;
  }

  isValid(context?: Context | null): boolean {
    if (!(context instanceof Context)) {
      throw new TypeError("Unexpected context type!");
    }

    const result = this.predicate ? this.predicate(context) : false;

    if (context.LogDecomposition) {
      context.DecompositionLog?.push(`FuncCondition(${this.Name}) => ${result}`);
    }

    return result;
  }
}

export default FuncCondition;
