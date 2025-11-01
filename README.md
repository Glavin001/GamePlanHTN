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
          context.Done = true;
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
            context.Done = true;
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

while (!context.Done) {
    planner.tick(domain, context);
}
```

### Slots and Functional Helpers

HTN-AI implements FluidHTN's slot system for runtime plan splicing. Slots can be declared in your domain and filled with tasks at planning time.

The library also includes `FuncCondition` and `FuncOperator` adapters so you can reuse existing functions or lambdas while preserving context validation and type inference. Refer to the `tests/` folder for comprehensive examples that mirror the FluidHTN C# suite.

## Development

```bash
npm install       # install dependencies
npm run build     # generate dist/ bundles (CJS, ESM, UMD) with type declarations
npm test          # execute the uvu test suite with tsx
npm run lint      # run ESLint with the TypeScript-aware configuration
npm run test:coverage  # generate c8 coverage reports
```

All commits are validated in CI on Node.js 16 and 18.
