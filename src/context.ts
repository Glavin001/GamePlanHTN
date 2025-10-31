import { ContextState, ContextStateValue } from "./contextState";
import EffectType, { EffectTypeValue } from "./effectType";
import type CompoundTask from "./Tasks/compoundTask";

export interface WorldStateChange {
  effectType: EffectTypeValue;
  value: number;
}

export type WorldState = Record<string, number>;
export type WorldStateChangeStack = Record<string, WorldStateChange[]>;

export interface PartialPlanEntry {
  task: CompoundTask;
  taskIndex: number;
}

class Context {
  public IsInitialized = false;

  public IsDirty = false;

  public ContextState: ContextStateValue = ContextState.Executing;

  public CurrentDecompositionDepth = 0;

  public WorldState: WorldState = {};

  public LastMTR: number[] = [];

  public MethodTraversalRecord: number[] = [];

  public WorldStateChangeStack: WorldStateChangeStack | null = null;

  public MTRDebug: string[] = [];

  public LastMTRDebug: string[] = [];

  public DebugMTR = false;

  public PartialPlanQueue: PartialPlanEntry[] = [];

  public DecompositionLog: string[] = [];

  public LogDecomposition = false;

  public HasPausedPartialPlan = false;

  init(): void {
    if (!this.WorldStateChangeStack) {
      this.WorldStateChangeStack = {};
      for (const stateKey of Object.keys(this.WorldState)) {
        this.WorldStateChangeStack[stateKey] = [];
      }
    }

    if (this.DebugMTR) {
      if (!this.MTRDebug) {
        this.MTRDebug = [];
      }
      if (!this.LastMTRDebug) {
        this.LastMTRDebug = [];
      }
    }

    if (this.LogDecomposition) {
      if (!this.DecompositionLog) {
        this.DecompositionLog = [];
      }
    }

    this.IsInitialized = true;
  }

  hasState(state: string, value = 1): boolean {
    return this.getState(state) === value;
  }

  getState(state: string): number {
    if (this.ContextState === ContextState.Executing) {
      return this.WorldState[state];
    }

    const stack = this.WorldStateChangeStack?.[state];
    if (!stack || stack.length === 0) {
      return this.WorldState[state];
    }

    return stack[0].value;
  }

  setState(state: string, value = 1, setAsDirty = true, effectType: EffectTypeValue = EffectType.Permanent): void {
    if (this.ContextState === ContextState.Executing) {
      if (this.WorldState[state] === value) {
        return;
      }

      this.WorldState[state] = value;
      if (setAsDirty) {
        this.IsDirty = true;
      }
    } else {
      if (!this.WorldStateChangeStack) {
        this.WorldStateChangeStack = {};
      }
      if (!this.WorldStateChangeStack[state]) {
        this.WorldStateChangeStack[state] = [];
      }
      this.WorldStateChangeStack[state].push({
        effectType,
        value,
      });
    }
  }

  reset(): void {
    this.MethodTraversalRecord = [];
    this.LastMTR = [];

    if (this.DebugMTR) {
      this.MTRDebug = [];
      this.LastMTRDebug = [];
    }

    this.IsInitialized = false;
  }

  getWorldStateChangeDepth(): Record<string, number> {
    if (!this.WorldStateChangeStack) {
      throw new Error("World state change stack has not been initialized");
    }

    const stackDepth: Record<string, number> = {};

    for (const worldStateKey of Object.keys(this.WorldStateChangeStack)) {
      const stack = this.WorldStateChangeStack[worldStateKey];
      stackDepth[worldStateKey] = stack ? stack.length : 0;
    }

    return stackDepth;
  }

  trimForExecution(): void {
    if (this.ContextState === ContextState.Executing) {
      throw new Error("Can not trim a context when in execution mode");
    }

    if (!this.WorldStateChangeStack) {
      return;
    }

    for (const worldStateKey of Object.keys(this.WorldStateChangeStack)) {
      const stack = this.WorldStateChangeStack[worldStateKey];

      if (!stack) {
        continue;
      }

      while (stack.length !== 0 && stack[0].effectType !== EffectType.Permanent) {
        stack.shift();
      }
    }
  }

  trimToStackDepth(stackDepth: Record<string, number>): void {
    if (this.ContextState === ContextState.Executing) {
      throw new Error("Can not trim a context when in execution mode");
    }

    if (!this.WorldStateChangeStack) {
      return;
    }

    for (const stackDepthKey of Object.keys(stackDepth)) {
      const stack = this.WorldStateChangeStack[stackDepthKey];

      if (!stack) {
        continue;
      }

      while (stack.length > stackDepth[stackDepthKey]) {
        stack.pop();
      }
    }
  }

  clearMTR(): void {
    this.MethodTraversalRecord = [];
  }

  // Retained for backwards compatibility with earlier typo.
  clarMTR(): void {
    this.clearMTR();
  }

  clearLastMTR(): void {
    this.LastMTR = [];
  }

  shiftMTR(): void {
    this.LastMTR = [];
    this.LastMTR.push(...this.MethodTraversalRecord);
  }

  restoreMTR(): void {
    this.MethodTraversalRecord = [];
    this.MethodTraversalRecord.push(...this.LastMTR);
    this.LastMTR = [];
  }

  clearLastMTRDebug(): void {
    this.LastMTRDebug = [];
  }

  shiftMTRDebug(): void {
    this.LastMTRDebug = [];
    this.LastMTRDebug.push(...this.MTRDebug);
  }

  restoreMTRDebug(): void {
    this.MTRDebug = [];
    this.MTRDebug.push(...this.LastMTRDebug);
    this.LastMTRDebug = [];
  }

  clearPartialPlanQueue(): void {
    this.PartialPlanQueue = [];
  }
}

export default Context;
