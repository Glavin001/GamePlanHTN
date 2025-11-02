import Context, { type WorldStateBase, type WorldStateChange } from "../src/context";
import Domain from "../src/domain";
import CompoundTask from "../src/Tasks/compoundTask";
import PrimitiveTask from "../src/Tasks/primitiveTask";
import Effect from "../src/effect";

type TestWorldState = {
  HasA: number;
  HasB: number;
  HasC: number;
  Done: boolean;
};

type TestContext = Context<TestWorldState>;

function getEmptyTestContext(): TestContext {
  const context = new Context<TestWorldState>({
    HasA: 0,
    HasB: 0,
    HasC: 0,
    Done: false,
  });

  return context;
}

function getEmptyCompoundTask<TContext extends Context<WorldStateBase> = Context>() {
  return new CompoundTask<TContext>({
    name: "TestTask",
    type: "sequence",
    conditions: [],
    // effects: [],
    tasks: [],
  });
}

function getEmptySelectorTask<TContext extends Context<WorldStateBase> = Context>(name) {
  return new CompoundTask<TContext>({
    name,
    type: "select",
    conditions: [],
    // effects: [],
    tasks: [],
  });
}

function getEmptySequenceTask<TContext extends Context<WorldStateBase> = Context>(name) {
  return new CompoundTask<TContext>({
    name,
    type: "sequence",
    conditions: [],
    // effects: [],
    tasks: [],
  });
}

function getSimplePrimitiveTask<TContext extends Context<WorldStateBase> = Context>(name) {
  return new PrimitiveTask<TContext>({
    name,
    conditions: [],
    effects: [],
  });
}

function getSimplePrimitiveTaskWithDoneCondition(name) {
  return getSimplePrimitiveTask<TestContext>(name).addCondition((context) => context.hasState("Done"));
}

function getEmptyTestDomain<TContext extends Context<WorldStateBase>>() {
  return new Domain<TContext>({ name: "Test" });
}

function getSimpleEffect(name, type, state) {
  return new Effect({
    name,
    type,
    action: (context, innerType) => {
      context.setState(state, 1, true, innerType ?? undefined);
    },
  });
}

function getWorldStateChangeStack<TWorldState extends WorldStateBase, TKey extends keyof TWorldState & string>(
  context: Context<TWorldState>,
  key: TKey,
): WorldStateChange<TWorldState[TKey]>[] {
  const stack = context.WorldStateChangeStack[key];

  if (!stack) {
    throw new Error(`Missing world state change stack for ${String(key)}`);
  }

  return stack as WorldStateChange<TWorldState[TKey]>[];
}

function shiftOrFail<T>(items: T[]): T {
  const value = items.shift();

  if (value === undefined) {
    throw new Error("Expected a value when shifting from array");
  }

  return value;
}

export {
  getEmptyTestContext,
  getEmptyCompoundTask,
  getEmptyTestDomain,
  getEmptySelectorTask,
  getSimplePrimitiveTask,
  getSimplePrimitiveTaskWithDoneCondition,
  getEmptySequenceTask,
  getSimpleEffect,
  getWorldStateChangeStack,
  shiftOrFail,
};

export type {
  TestWorldState,
  TestContext,
};
