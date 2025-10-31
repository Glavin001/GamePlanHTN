import { test } from "uvu";
import * as assert from "uvu/assert";
import Domain from "../src/domain";
import DomainBuilder from "../src/domainBuilder";
import Context from "../src/context";
import { EffectType } from "../src/effectType";
import { TaskStatus } from "../src/taskStatus";
import CompoundTask from "../src/Tasks/compoundTask";
import PrimitiveTask from "../src/Tasks/primitiveTask";
import PausePlanTask from "../src/Tasks/pausePlanTask";
import Slot from "../src/Tasks/slot";
const createBuilder = () => new DomainBuilder("Test");

test("Build returns domain with root", () => {
  const builder = createBuilder();
  const domain = builder.build();

  assert.instance(domain, Domain);
  assert.ok(domain.Root instanceof CompoundTask);
  assert.throws(() => builder.pointer);
});

test("Build throws if pointer not restored", () => {
  const builder = createBuilder();
  builder.select("select test");

  assert.throws(() => builder.build());
});

test("Select pushes pointer and end restores", () => {
  const builder = createBuilder();
  builder.select("select test");

  assert.ok(builder.pointer instanceof CompoundTask);
  assert.is((builder.pointer as CompoundTask).Type, "select");

  builder.end();
  assert.is(builder.pointer?.Name, "Root");
});

test("Sequence pushes pointer and end restores", () => {
  const builder = createBuilder();
  builder.sequence("sequence test");

  assert.is((builder.pointer as CompoundTask | undefined)?.Type, "sequence");

  builder.end();
  assert.is(builder.pointer?.Name, "Root");
});

test("Action pushes primitive task", () => {
  const builder = createBuilder();
  builder.action("do something");

  assert.ok(builder.pointer instanceof PrimitiveTask);
});

test("Pause plan only allowed within sequence", () => {
  const builder = createBuilder();
  assert.throws(() => builder.pausePlan(), /Sequence/);

  builder.sequence("sequence");
  builder.pausePlan();

  assert.is((builder.pointer as CompoundTask | undefined)?.Type, "sequence");

  builder.end();
  const domain = builder.build();
  const sequenceTask = domain.Root.Children[0] as CompoundTask;
  assert.ok(sequenceTask.Children.some((child) => child instanceof PausePlanTask));
});

test("Condition attaches to current pointer", () => {
  const builder = createBuilder();
  builder.select("select").condition("test", () => true);
  assert.is(builder.pointer?.Conditions.length, 1);
});

test("Executing condition requires primitive task", () => {
  const builder = createBuilder();
  assert.throws(() => builder.executingCondition("invalid", () => true));

  builder.action("primitive").executingCondition("valid", () => true);
  const primitive = builder.pointer as PrimitiveTask;
  assert.is(primitive.ExecutingConditions.length, 1);
});

test("Do requires primitive pointer", () => {
  const builder = createBuilder();
  assert.throws(() => builder.do(() => TaskStatus.Success));

  builder.action("primitive").do(() => TaskStatus.Success);
  assert.type((builder.pointer as PrimitiveTask).operator, "function");
});

test("Do assigns operator with optional handlers", () => {
  const builder = createBuilder();
  let stopped = false;
  let aborted = false;
  builder.action("primitive").do(
    () => TaskStatus.Success,
    () => {
      stopped = true;
    },
    () => {
      aborted = true;
    },
  );
  const primitive = builder.pointer as PrimitiveTask;
  assert.type(primitive.operator, "function");
  const context = new Context();
  context.init();
  primitive.stop(context);
  primitive.abort(context);
  assert.ok(stopped);
  assert.ok(aborted);
});

test("Effect attaches to primitive", () => {
  const builder = createBuilder();
  builder.action("primitive").effect("effect", EffectType.PlanOnly, () => undefined);
  const primitive = builder.pointer as PrimitiveTask;
  assert.is(primitive.Effects.length, 1);
});

test("Effect requires primitive pointer", () => {
  const builder = createBuilder();
  assert.throws(() => builder.effect("effect", EffectType.PlanOnly, () => undefined));
});

test("Splice requires compound pointer", () => {
  const builder = createBuilder();
  const sub = new DomainBuilder("Sub").action("primitive").do(() => TaskStatus.Success).end().build();

  assert.throws(() => builder.action("primitive").splice(sub));

  const sequenceBuilder = createBuilder();
  sequenceBuilder.sequence("seq").splice(sub);
  const parent = sequenceBuilder.pointer as CompoundTask;
  assert.is(parent.Children.length, 1);
});

test("Slot creation and assignment", () => {
  const builder = createBuilder();
  builder.slot(1);
  const domain = builder.build();

  const slot = domain.Root.Children[0];
  assert.ok(slot instanceof Slot);

  const sub = new DomainBuilder("Sub").sequence("inner").action("primitive").do(() => TaskStatus.Success).end().end().build();
  assert.ok(domain.trySetSlotDomain(1, sub));
  assert.not.ok(domain.trySetSlotDomain(1, sub));
  domain.clearSlot(1);
  assert.ok(domain.trySetSlotDomain(1, sub));
});

test("Slot requires compound pointer and unique id", () => {
  const builder = createBuilder();
  builder.action("primitive");
  assert.throws(() => builder.slot(1));

  const sequenceBuilder = createBuilder();
  sequenceBuilder.sequence("seq").slot(1);
  assert.throws(() => sequenceBuilder.slot(1));
});

test("Forgotten end keeps pointer on compound task", () => {
  const builder = createBuilder();
  builder.sequence("sequence test");
  assert.ok(builder.pointer instanceof CompoundTask);
});

test("Executing condition without end keeps pointer on primitive", () => {
  const builder = createBuilder();
  builder.action("primitive").executingCondition("valid", () => true);
  assert.ok(builder.pointer instanceof PrimitiveTask);
});

test("Do without end keeps pointer on primitive", () => {
  const builder = createBuilder();
  builder.action("primitive").do(() => TaskStatus.Success);
  assert.ok(builder.pointer instanceof PrimitiveTask);
});

test.run();
