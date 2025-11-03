import { ContextState, ContextStateValue } from "./contextState";
import EffectType, { EffectTypeValue } from "./effectType";
import type CompoundTask from "./Tasks/compoundTask";

export interface WorldStateChange<TValue> {
  effectType: EffectTypeValue;
  value: TValue;
}

export type WorldStateBase = Record<string, unknown>;

/**
 * @deprecated Use WorldStateBase instead
 */
export type WorldState = Record<string, number>;

export type WorldStateChangeStack<_TWorldState extends WorldStateBase> = Record<string, WorldStateChange<unknown>[]>;

export interface PartialPlanEntry {
  task: CompoundTask;
  taskIndex: number;
}

class Context<TWorldState extends WorldStateBase = WorldStateBase> {
  public IsInitialized = false;

  public IsDirty = false;

  public ContextState: ContextStateValue = ContextState.Executing;

  public CurrentDecompositionDepth = 0;

  public WorldState: TWorldState;

  public LastMTR: number[] = [];

  public MethodTraversalRecord: number[] = [];

  public WorldStateChangeStack: WorldStateChangeStack<TWorldState>;

  public MTRDebug: string[] = [];

  public LastMTRDebug: string[] = [];

  public DebugMTR = false;

  public PartialPlanQueue: PartialPlanEntry[] = [];

  public DecompositionLog: string[] = [];

  public LogDecomposition = false;

  public HasPausedPartialPlan = false;

  constructor(initialWorldState?: TWorldState) {
    this.WorldState = initialWorldState ? { ...initialWorldState } : ({} as TWorldState);
    this.WorldStateChangeStack = {} as WorldStateChangeStack<TWorldState>;
  }

  init(): void {
    const stack = {} as WorldStateChangeStack<TWorldState>;
    for (const stateKey of Object.keys(this.WorldState) as Array<keyof TWorldState & string>) {
      stack[stateKey] = [];
    }
    this.WorldStateChangeStack = stack;

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

  // The `HasState` method returns `true` if the value of the state at the specified index in the `WorldState` array
  // is equal to the specified value. Otherwise, it returns `false`.
  hasState<TStateKey extends keyof TWorldState & string>(
    state: TStateKey,
    value: TWorldState[TStateKey] = this.getDefaultStateValue(state),
  ): boolean {
    return this.getState(state) === value;
  }

  // The `GetState` method returns the value of the state at the specified index in the `WorldState` array.
  // If the `ContextState` is `ContextState.Executing`, it returns the value from the `WorldState` array directly.
  // Otherwise, it returns the value of the topmost object in the `WorldStateChangeStack` array at the specified index,
  // or the value from the `WorldState` array if the stack is empty.
  getState<TStateKey extends keyof TWorldState & string>(state: TStateKey): TWorldState[TStateKey] {
    if (this.ContextState === ContextState.Executing) {
      return this.WorldState[state];
    }

    const key = state as keyof TWorldState & string;
    const stack = this.WorldStateChangeStack[key] as
      | WorldStateChange<TWorldState[TStateKey]>[]
      | undefined;
    if (!stack || stack.length === 0) {
      return this.WorldState[state];
    }

    return stack[0].value as TWorldState[TStateKey];
  }

  // The `SetState` method sets the value of the state at the specified index in the `WorldState` array.
  // If the `ContextState` is `ContextState.Executing`, it sets the `IsDirty` property to `true` if `setAsDirty` is `true`
  // and the value of the state is not already equal to the specified value.
  // Otherwise, it adds a new object to the `WorldStateChangeStack` array at the specified index with properties
  // "effectType" and "value".
  setState<TStateKey extends keyof TWorldState & string>(
    stateKey: TStateKey,
    value: TWorldState[TStateKey] = this.getDefaultStateValue(stateKey),
    setAsDirty = true,
    effectType: EffectTypeValue = EffectType.Permanent,
  ): void {
    if (this.ContextState === ContextState.Executing) {
      // Prevent setting the world state dirty if we're not changing anything.
      if (this.WorldState[stateKey] === value) {
        return;
      }

      this.WorldState[stateKey] = value;
      if (setAsDirty) {
        // When a state change during execution, we need to mark the context dirty for replanning!
        this.IsDirty = true;
      }
    } else {
      const stack = this.getOrCreateWorldStateChangeStack(stateKey);
      stack.push({
        effectType,
        value,
      });
    }
  }

  // The `Reset` method clears the `MethodTraversalRecord` and `LastMTR` arrays.
  // If `DebugMTR` is `true`, it also clears the `MTRDebug` and `LastMTRDebug` arrays.
  // Finally, it sets the `IsInitialized` property to `false`.
  reset(): void {
    this.MethodTraversalRecord = [];
    this.LastMTR = [];

    if (this.DebugMTR) {
      this.MTRDebug = [];
      this.LastMTRDebug = [];
    }

    this.IsInitialized = false;
  }

  // The `GetWorldStateChangeDepth` method returns an array containing the
  // length of each stack in the `WorldStateChangeStack` array. If a stack
  // is `null`, its length is `0`.
  getWorldStateChangeDepth(): Record<string, number> {
    if (!this.IsInitialized) {
      throw new Error("World state change stack has not been initialized");
    }

    const stackDepth: Record<string, number> = {};

    for (const worldStateKey of Object.keys(this.WorldStateChangeStack)) {
      const stack = this.WorldStateChangeStack[worldStateKey];
      stackDepth[worldStateKey] = stack ? stack.length : 0;
    }

    return stackDepth;
  }

  // The `TrimForExecution` method trims the `WorldStateChangeStack` array
  // by removing all elements that are not of type `EffectType.Permanent`.
  // If the `ContextState` is `ContextState.Executing`, an error is thrown.
  trimForExecution(): void {
    if (this.ContextState === ContextState.Executing) {
      throw new Error("Can not trim a context when in execution mode");
    }

    if (!this.IsInitialized) {
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

  // The `TrimToStackDepth` method trims the `WorldStateChangeStack` array
  // to the specified depth for each element in the `stackDepth` array.
  // If the `ContextState` is `ContextState.Executing`, an error is thrown.
  trimToStackDepth(stackDepth: Record<string, number>): void {
    if (this.ContextState === ContextState.Executing) {
      throw new Error("Can not trim a context when in execution mode");
    }

    if (!this.IsInitialized) {
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

  private getDefaultStateValue<TStateKey extends keyof TWorldState & string>(
    state: TStateKey,
  ): TWorldState[TStateKey] {
    const currentValue = this.WorldState[state];

    if (typeof currentValue === "boolean") {
      return true as TWorldState[TStateKey];
    }

    if (typeof currentValue === "number" || typeof currentValue === "undefined") {
      return 1 as unknown as TWorldState[TStateKey];
    }

    return currentValue;
  }

  private getOrCreateWorldStateChangeStack<TStateKey extends keyof TWorldState & string>(
    stateKey: TStateKey,
  ): WorldStateChange<TWorldState[TStateKey]>[] {
    if (!this.WorldStateChangeStack[stateKey]) {
      this.WorldStateChangeStack[stateKey] = [];
    }

    return this.WorldStateChangeStack[stateKey] as WorldStateChange<TWorldState[TStateKey]>[];
  }
}

export default Context;
