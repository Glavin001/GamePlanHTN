# HTN-AI

A simple but powerful HTN planner written in TypeScript (and still consumable from JavaScript) forked from [GamePlanHTN](https://github.com/TotallyGatsby/GamePlanHTN) and based on the excellent work of [FluidHTN](https://github.com/ptrefall/fluid-hierarchical-task-network). There are several changes to the library to make it more idiomatic for the JS/TS ecosystem (these are detailed below.)

> Portions of this project are derived from FluidHTN (MIT License) by Pål Trefall.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![Build](https://github.com/TotallyGatsby/GamePlanHTN/actions/workflows/ci.yml/badge.svg)

## Features
* Total-order forward decomposition planner as described by Troy Humphreys in his [GameAIPro article](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter12_Exploring_HTN_Planners_through_Example.pdf), ported from [FluidHTN](https://github.com/ptrefall/fluid-hierarchical-task-network).
* First-class TypeScript support with generated declaration files while remaining frictionless for vanilla JavaScript projects.
* Define domains via plain objects **or** with a fluent `DomainBuilder` helper for ergonomic strongly-typed definitions.
* Partial planning with domain slots for run-time splicing.
* Replanning only when plans complete/fail or when world state changes.
* Early rejection of replanning that cannot be completed.
* Extensible primitive operators, effects, and conditions including functional adapters.
* Decomposition logging utilities for debugging.
* 100% parity test coverage with FluidHTN plus additional regression tests for HTN-AI-specific features.

## Installation

```bash
npm install htn-ai
```

HTN-AI targets Node.js 16+ (matching the active LTS releases). Bundled builds are published in both CommonJS and ES Module formats with type declarations.


# Library
## Usage

### Creating a Domain

You can define a domain via plain data or use the fluent builder helpers. The builder is particularly convenient in TypeScript where editor IntelliSense surfaces task configuration options.

```ts
import { DomainBuilder, TaskStatus } from "htn-ai";

const domain = DomainBuilder.begin("Example")
  .select("GetC", (getC) =>
    getC.primitive("Get C", (task) =>
      task
        .condition((context) => context.hasState("HasA") && context.hasState("HasB"))
        .condition((context) => !context.hasState("HasC"))
        .do({
          execute: () => TaskStatus.Success,
          effect: (context) => context.setState("HasC"),
        }),
    ),
  )
  .sequence("GetAandB", (sequence) =>
    sequence
      .primitive("Get A", (task) =>
        task
          .condition((context) => !(context.hasState("HasA") && context.hasState("HasB")))
          .do({
            execute: () => TaskStatus.Success,
            effect: (context) => context.setState("HasA"),
          }),
      )
      .primitive("Get B", (task) =>
        task.do({
          execute: () => TaskStatus.Success,
          effect: (context) => context.setState("HasB"),
        }),
      ),
  )
  .select("Done", (done) =>
    done.primitive("Done", (task) =>
      task.do({
        execute: (context) => {
          context.setState("Done", true, false);
          return TaskStatus.Continue;
        },
      }),
    ),
  )
  .end();
```

Prefer the original JSON-style description? It continues to work and is still fully supported.

Defining a domain is done via a JavaScript object. Functions can be embedded directly into the domain definition, or passed into the domain later if you'd prefer to keep definitions strictly JSON.

```js
import { Context, Domain, Planner, TaskStatus } from "htn-ai";
import log from "loglevel";

const domain = new Domain({
  name: "MyDomain",
  tasks: [
    {
      name: "GetC",
      type: "select",
      tasks: [
        {
          name: "Get C (Primitive Task)",
          conditions: [
            // Has A and B
            (context) => context.hasState("HasA") && context.hasState("HasB"),
            // Has NOT C
            (context) => !context.hasState("HasC"),
          ],
          operator: () => {
            log.info("Get C");

            return TaskStatus.Success;
          },
          effects: [
            // Has C
            (context) => context.setState("HasC"),
          ],
        },
      ],
    },
    {
      name: "GatAandB",
      type: "sequence",
      tasks: [
        {
          name: "Get A (Primitive Task)",
          conditions: [
            // Has NOT A NOR B
            (context) => !(context.hasState("HasA") && context.hasState("HasB")),
          ],
          operator:
            // Get A
            () => {
              log.info("Get A");

              return TaskStatus.Success;
            },
          effects: [
            // Has A
            (context) => context.setState("HasA"),
          ],
        }, {
          name: "Get B (Primitive Task)",
          operator:
            // Get A
            () => {
              log.info("Get B");

              return TaskStatus.Success;
            },
          effects: [
            // Has B
            (context) => context.setState("HasB"),
          ],
        },
      ],
    },
    {
      name: "Done",
      type: "select",
      tasks: [
        {
          name: "Done",
          operator: (context) => {
            log.info("Done");
            context.setState("Done", true, false);
            return TaskStatus.Continue;
          },
        },
      ],
    },
  ],
});
```

### Creating a Context

A context is used to track our world state for the purposes of planning. A `Context` contains methods for setting/getting world state, and starts with a simple set of `getState()`, `setState()` and `hasState()` methods, but in most cases you will want to add functions to the Context object. (The legacy capitalized APIs are still available for compatibility with the original JavaScript samples.)

There are a few significant changes from FluidHTN:
1) HTN-AI uses object keys for world state rather than an array indexed by an enum, this simplifies finding worldstate to `context.WorldState.HasC` rather than `context.WorldState[(int)MyWorldState.HasC]`
1) The Context object's function set is mutable at runtime. You can assign functions directly to it at runtime, which means you do not necessarily need to subclass it for simple cases.

```js
let context = new Context();

context.WorldState = {
  HasA: 0,
  HasB: 0,
  HasC: 0,
  Done: false,
};

context.init();
```

### Planning
With a context and a domain, we can now perform planning by ticking the planner until it sets `Done` to true on the context.

```js
let domain = new Domain({ /* see large definition above */});
let context = new Context();
context.WorldState = {
  HasA: 0,
  HasB: 0,
  HasC: 0,
};

let planner = new Planner();
context.init();

while (!context.hasState("Done")) {
    planner.tick(domain, context);
}
```

If you need to check or mutate the done flag programmatically, prefer the typed accessors:

```js
context.setState("Done", true, false);
const isDone = context.getState("Done") === true;
```
```

### Slots and Functional Helpers

HTN-AI implements FluidHTN's slot system for runtime plan splicing. Slots can be declared in your domain and filled with tasks at planning time.

The library also includes `FuncCondition` and `FuncOperator` adapters so you can reuse existing functions or lambdas while preserving context validation and type inference. Refer to the `tests/` folder for comprehensive examples that mirror the FluidHTN C# suite.

### Utility & GOAP Extensions

HTN-AI ships opt-in helpers inspired by the Fluid HTN extension pack:

#### Utility selectors

- Attach utility scores with `.utility(scoreFn)` on any child in the builder, or create primitives with `.utilityAction(name, scoreFn)`.
- Scores can inspect arbitrary context, and invalid children are skipped automatically.
- When multiple valid children share the same score, the selector keeps declaration order, giving deterministic behaviour.

```ts
DomainBuilder.begin("Gathering")
  .utilitySelect("Pick Source")
    .utilityAction("Scrap Heap", (ctx) => ctx.getState("ScrapNearby") ? 5 : 1)
      .do(() => TaskStatus.Success)
    .end()
    .sequence("Mine Vein")
      .utility((ctx) => ctx.getState("PickaxeLevel"))
      .action("WalkToVein").do(...).end()
      .action("MineVein").do(...).end()
    .end()
  .end()
  .end();
```

#### GOAP sequences

- Declare a goal with `.goapSequence(name, { StateKey: desiredValue })`.
- Each child is a primitive `.goapAction(name, costFn?)`. Omit the second argument for the default cost of `1`, or supply a function returning a numeric cost.
- Costs accumulate across the plan; the planner always returns the lowest-cost valid path while avoiding world-state cycles.
- If the goal is already satisfied, the sequence succeeds with an empty plan (no-op).
- Cost/score functions receive the live planning context, so you can compute dynamic values (distance, equipment modifiers, injuries, etc.).

```ts
const distance = (from: string, to: string) => Math.abs(/* ... */);

DomainBuilder.begin("Heist")
  .goapSequence("CrackSafe", { HasLoot: 1 })
    .sequence("Stealth Route")
      .cost(() => 2) // base cost for choosing this compound branch
      .action("PickLock")
        .condition("Has Lockpick", (ctx) => ctx.hasState("Lockpick"))
        .effect("DoorOpen", EffectType.PlanOnly, (ctx, type) => ctx.setState("DoorOpen", 1, false, type))
      .end()
      .action("GrabLoot")
        .condition("DoorOpen", (ctx) => ctx.hasState("DoorOpen"))
        .effect("HasLoot", EffectType.PlanOnly, (ctx, type) => ctx.setState("HasLoot", 1, false, type))
      .end()
    .end()
    .goapAction("WalkToVan", (ctx) => {
      const meters = distance(ctx.getState("AgentNode"), "GetawayVan");
      const injuryFactor = ctx.hasState("LegInjured") ? 2 : 1;
      return meters * injuryFactor; // walking is slower if injured
    })
      .effect("ReachVan", EffectType.PlanOnly, (ctx, type) => {
        ctx.setState("AgentNode", "GetawayVan", false, type);
      })
    .end()
    .goapAction("DriveToVan", (ctx) => {
      if (!ctx.hasState("HasVehicle")) {
        return Number.POSITIVE_INFINITY;
      }
      const meters = distance(ctx.getState("AgentNode"), "GetawayVan");
      return meters * 0.5; // driving is faster
    })
      .effect("ReachVan", EffectType.PlanOnly, (ctx, type) => {
        ctx.setState("AgentNode", "GetawayVan", false, type);
      })
    .end()
  .end()
  .end();
```

Both features remain opt-in—existing domains continue to work unchanged. See `tests/utilitySelector.ts` and `tests/goapSequence.ts` for exhaustive coverage of scoring, tie-breaking, cycle avoidance, deterministic path selection, irrelevant-action pruning, and immediate-goal success scenarios.

## Development

```bash
npm install       # install dependencies
npm run build     # generate dist/ bundles (CJS, ESM, UMD) with type declarations
npm test          # execute the uvu test suite with tsx
npm run lint      # run ESLint with the TypeScript-aware configuration
npm run test:coverage  # generate c8 coverage reports
```

All commits are validated in CI on Node.js 16 and 18.
