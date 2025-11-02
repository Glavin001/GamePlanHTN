import { test } from "uvu";
import * as assert from "uvu/assert";
import Context from "../src/context";
import DomainBuilder from "../src/domainBuilder";
import PrimitiveTask from "../src/Tasks/primitiveTask";
import TaskStatus from "../src/taskStatus";
import { EffectType } from "../src/effectType";
import DecompositionStatus from "../src/decompositionStatus";

const createContext = (): Context => {
  const ctx = new Context();
  ctx.WorldState = {
    ShouldDoDynamic: 1,
    Delivered: 0,
    AgentPos: "A",
    DoorUnlocked: 0,
    HasKey: 1,
    HasItem: 1,
  } as Record<string, unknown>;
  ctx.init();
  return ctx;
};

const createMovePrimitive = (from: string, to: string, cost: number): PrimitiveTask<Context> => {
  const primitive = new PrimitiveTask<Context>({
    name: `Move ${from}->${to}`,
    conditions: [
      (context) => context.getState("AgentPos") === from,
    ],
    operator: () => TaskStatus.Success,
    effects: [
      {
        name: `Set position ${to}`,
        type: EffectType.PlanOnly,
        action: (context, effectType) => {
          context.setState("AgentPos", to, false, effectType ?? EffectType.PlanOnly);
        },
      },
    ],
  });

  primitive.setGoapCost(() => cost);

  return primitive;
};

const createUnlockDoor = (): PrimitiveTask<Context> => {
  const primitive = new PrimitiveTask<Context>({
    name: "Unlock door",
    conditions: [
      (context) => context.getState("AgentPos") === "B",
      (context) => context.getState("DoorUnlocked") !== 1,
      (context) => context.hasState("HasKey", 1),
    ],
    operator: () => TaskStatus.Success,
    effects: [
      {
        name: "Door unlocked",
        type: EffectType.PlanOnly,
        action: (context, effectType) => {
          context.setState("DoorUnlocked", 1, false, effectType ?? EffectType.PlanOnly);
        },
      },
    ],
  });

  primitive.setGoapCost(() => 0);

  return primitive;
};

const createDeliver = (position = "C"): PrimitiveTask<Context> => {
  const primitive = new PrimitiveTask<Context>({
    name: "Deliver item",
    conditions: [
      (context) => context.getState("AgentPos") === position,
      (context) => context.hasState("HasItem", 1),
    ],
    operator: () => TaskStatus.Success,
    effects: [
      {
        name: "Mark delivered",
        type: EffectType.PlanOnly,
        action: (context, effectType) => {
          context.setState("Delivered", 1, false, effectType ?? EffectType.PlanOnly);
          context.setState("HasItem", 0, false, effectType ?? EffectType.PlanOnly);
        },
      },
    ],
  });

  primitive.setGoapCost(() => 0);

  return primitive;
};

test("HTN dynamic generator produces contextual subtasks", () => {
  const ctx = createContext();
  const builder = new DomainBuilder<Context>("Dynamic HTN");

  builder.sequence("Root");
  builder.generate(({ context }) => {
    if (context.hasState("ShouldDoDynamic", 1)) {
      return [
        new PrimitiveTask<Context>({
          name: "Dynamic action",
          operator: () => TaskStatus.Success,
          effects: [
            {
              name: "Clear flag",
              type: EffectType.PlanOnly,
              action: (innerContext, effectType) => {
                innerContext.setState("ShouldDoDynamic", 0, false, effectType ?? EffectType.PlanOnly);
              },
            },
          ],
        }),
      ];
    }

    return [];
  });

  builder.action("Fallback").do(() => TaskStatus.Success).end();
  builder.end();

  const domain = builder.build();
  const { plan, status } = domain.findPlan(ctx);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.is(plan.length, 2);
  assert.equal(
    plan.map((task) => task.Name),
    ["Fallback", "Dynamic action"],
  );
});

test("GOAP dynamic generators unlock new successors mid-plan", () => {
  const ctx = createContext();
  const builder = new DomainBuilder<Context>("Dynamic GOAP");

  builder.goapSequence("Deliver", { Delivered: 1 });
  builder.goapGenerate(({ context }) => {
    const position = context.getState("AgentPos") as string;
    const tasks: PrimitiveTask<Context>[] = [];

    if (position === "A") {
      tasks.push(createMovePrimitive("A", "B", 1));
    }

    if (position === "B" && context.getState("DoorUnlocked") === 1) {
      tasks.push(createMovePrimitive("B", "C", 1));
    }

    return tasks;
  });

  builder.goapGenerate(({ context }) => {
    const tasks: PrimitiveTask<Context>[] = [];
    const position = context.getState("AgentPos") as string;

    if (position === "B") {
      tasks.push(createUnlockDoor());
    }

    if (position === "C") {
      tasks.push(createDeliver());
    }

    return tasks;
  });

  builder.end();

  const domain = builder.build();
  const { status, plan } = domain.findPlan(ctx);

  assert.is(status, DecompositionStatus.Succeeded);
  assert.equal(
    plan.map((task) => task.Name),
    ["Move A->B", "Unlock door", "Move B->C", "Deliver item"],
  );
});

test("GOAP dynamic generators dedupe names after static children", () => {
  const ctx = createContext();
  const builder = new DomainBuilder<Context>("Dynamic GOAP Dedupe");

  builder.goapSequence("Reach B", { Delivered: 1 });

  builder
    .goapAction("Move A->B", () => 5)
    .condition("At A", (context) => context.getState("AgentPos") === "A")
    .effect("Arrive at B", EffectType.PlanOnly, (context, effectType) => {
      context.setState("AgentPos", "B", false, effectType ?? EffectType.PlanOnly);
    })
    .end();

  builder.goapGenerate(({ context }) => {
    if (context.getState("AgentPos") === "A") {
      return [createMovePrimitive("A", "B", 1), createDeliver("B")];
    }

    if (context.getState("AgentPos") === "B") {
      return [createDeliver("B")];
    }

    return [];
  });

  builder.end();

  const domain = builder.build();
  const { plan } = domain.findPlan(ctx);

  assert.ok(plan);
  assert.is(plan[0].Name, "Move A->B");
  assert.is(plan.length, 2);
  assert.is(plan[1].Name, "Deliver item");
  assert.is(plan[0].getGoapCost(ctx), 5);
});

test.run();
