import { test } from "uvu";
import * as assert from "uvu/assert";

import FuncOperator from "../src/operators/funcOperator";
import Context from "../src/context";
import TaskStatus from "../src/taskStatus";

test("FuncOperator update returns failure without update function", () => {
  const operator = new FuncOperator();
  const context = new Context();
  context.init();

  const status = operator.update(context);

  assert.is(status, TaskStatus.Failure);
});

test("FuncOperator stop is no-op without handler", () => {
  const operator = new FuncOperator();
  const context = new Context();
  context.init();

  operator.stop(context);
});

test("FuncOperator abort is no-op without handler", () => {
  const operator = new FuncOperator();
  const context = new Context();
  context.init();

  operator.abort(context);
});

test("FuncOperator throws when context is invalid", () => {
  const operator = new FuncOperator();

  assert.throws(() => {
    operator.update(null);
  });

  assert.throws(() => {
    operator.stop(undefined);
  });

  assert.throws(() => {
    operator.abort(null);
  });
});

test("FuncOperator delegates update to callback", () => {
  const context = new Context();
  context.init();
  const operator = new FuncOperator(() => TaskStatus.Success);

  const status = operator.update(context);

  assert.is(status, TaskStatus.Success);
});

test("FuncOperator delegates stop and abort", () => {
  const context = new Context();
  context.init();
  const stopped: Context[] = [];
  const aborted: Context[] = [];
  const operator = new FuncOperator(
    undefined,
    (ctx) => stopped.push(ctx),
    (ctx) => aborted.push(ctx),
  );

  operator.stop(context);
  operator.abort(context);

  assert.is(stopped.length, 1);
  assert.is(aborted.length, 1);
});

test.run();
