import { test } from "uvu";
import * as assert from "uvu/assert";
import Context from "../src/context";
import DomainBuilder from "../src/domainBuilder";
import DecompositionStatus from "../src/decompositionStatus";
import TaskStatus from "../src/taskStatus";

test("Utility selector picks the highest utility action", () => {
  const builder = new DomainBuilder<Context>("Utility Test");

  builder.utilitySelect("Choose");

  builder
    .utilityAction("Low", () => 1)
    .do(() => TaskStatus.Success)
    .end();

  builder
    .utilityAction("High", () => 10)
    .do(() => TaskStatus.Success)
    .end();

  builder.end();

  const domain = builder.build();

  const ctx = new Context();
  ctx.WorldState = {};
  ctx.init();

  const { status, plan } = domain.findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.is(plan[0].Name, "High");
});

test("Utility selector ignores higher-scoring invalid actions", () => {
  const builder = new DomainBuilder<Context>("Utility Invalid Test");

  builder.utilitySelect("Choose");

  builder
    .utilityAction("Invalid", () => 100)
    .condition("Needs Ready", (context) => context.hasState("Ready"))
    .do(() => TaskStatus.Success)
    .end();

  builder
    .utilityAction("Fallback", () => 1)
    .do(() => TaskStatus.Success)
    .end();

  builder.end();

  const ctx = new Context();
  ctx.WorldState = { Ready: 0 };
  ctx.init();

  const { status, plan } = builder.build().findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.is(plan[0].Name, "Fallback");
});

test("Utility selector keeps first child when utilities tie", () => {
  const builder = new DomainBuilder<Context>("Utility Tie Test");

  builder.utilitySelect("Choose");

  builder
    .utilityAction("First", () => 5)
    .do(() => TaskStatus.Success)
    .end();

  builder
    .utilityAction("Second", () => 5)
    .do(() => TaskStatus.Success)
    .end();

  builder.end();

  const ctx = new Context();
  ctx.WorldState = {};
  ctx.init();

  const { status, plan } = builder.build().findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 1);
  assert.is(plan[0].Name, "First");
});

test("Utility selector can score compound subtasks", () => {
  const builder = new DomainBuilder<Context>("Utility Compound Test");

  builder.utilitySelect("Choose");

  builder
    .sequence("High Sequence")
    .utility(() => 10)
    .action("Step 1")
      .do(() => TaskStatus.Success)
      .end()
    .action("Step 2")
      .do(() => TaskStatus.Success)
      .end()
    .end();

  builder
    .utilityAction("Low", () => 1)
    .do(() => TaskStatus.Success)
    .end();

  builder.end();

  const ctx = new Context();
  ctx.WorldState = {};
  ctx.init();

  const { status, plan } = builder.build().findPlan(ctx);

  assert.equal(status, DecompositionStatus.Succeeded);
  assert.ok(plan);
  assert.equal(plan.length, 2);
  assert.is(plan[0].Name, "Step 1");
  assert.is(plan[1].Name, "Step 2");
});

test.run();

