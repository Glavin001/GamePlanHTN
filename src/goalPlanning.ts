import Domain from "./domain";
import DomainBuilder from "./domainBuilder";
import Context from "./context";
import TaskStatus, { type TaskStatusValue } from "./taskStatus";

export type GoalProgramKind =
  | "doInOrder"
  | "doInParallel"
  | "perform"
  | "whileConditionHolds"
  | "withOperators";

export interface ExecutingConditionSpec<TContext extends Context = Context> {
  readonly name: string;
  readonly predicate: (context: TContext) => boolean;
}

export interface OperatorSpec<TContext extends Context = Context> {
  readonly name: string;
  readonly operation: (context: TContext) => TaskStatusValue;
  readonly forceStop?: (context: TContext) => void;
  readonly abort?: (context: TContext) => void;
}

export abstract class GoalProgram {
  abstract readonly kind: GoalProgramKind;
}

export class DoInOrder extends GoalProgram {
  readonly kind = "doInOrder" as const;
  readonly steps: GoalProgram[];
  readonly label: string;

  constructor(steps: GoalProgram[], label = "Do In Order") {
    super();
    this.steps = steps;
    this.label = label;
  }
}

export class DoInParallel extends GoalProgram {
  readonly kind = "doInParallel" as const;
  readonly branches: GoalProgram[];
  readonly label: string;

  constructor(branches: GoalProgram[], label = "Do In Parallel (Serialized)") {
    super();
    this.branches = branches;
    this.label = label;
  }
}

export class Perform<TAction extends string = string, TPayload = unknown> extends GoalProgram {
  readonly kind = "perform" as const;
  readonly action: TAction;
  readonly payload: TPayload;
  readonly label?: string;

  constructor(action: TAction, payload: TPayload, label?: string) {
    super();
    this.action = action;
    this.payload = payload;
    this.label = label;
  }
}

export class WhileConditionHolds<TContext extends Context = Context> extends GoalProgram {
  readonly kind = "whileConditionHolds" as const;
  readonly condition: ExecutingConditionSpec<TContext>;
  readonly subgoal: GoalProgram;

  constructor(condition: ExecutingConditionSpec<TContext>, subgoal: GoalProgram) {
    super();
    this.condition = condition;
    this.subgoal = subgoal;
  }
}

export class WithOperators<TContext extends Context = Context> extends GoalProgram {
  readonly kind = "withOperators" as const;
  readonly label: string;
  readonly enter: OperatorSpec<TContext>[];
  readonly exit: OperatorSpec<TContext>[];
  readonly subgoal: GoalProgram;
  readonly executingConditions: ExecutingConditionSpec<TContext>[];

  constructor(
    label: string,
    enter: OperatorSpec<TContext>[],
    subgoal: GoalProgram,
    exit: OperatorSpec<TContext>[] = [],
    executingConditions: ExecutingConditionSpec<TContext>[] = [],
  ) {
    super();
    this.label = label;
    this.enter = enter;
    this.subgoal = subgoal;
    this.exit = exit;
    this.executingConditions = executingConditions;
  }
}

export interface GoalCompilationHandlers<TContext extends Context = Context> {
  perform(
    builder: DomainBuilder<TContext>,
    action: Perform,
    executingConditions: readonly ExecutingConditionSpec<TContext>[],
  ): void;
}

export const applyExecutingConditions = <TContext extends Context = Context>(
  builder: DomainBuilder<TContext>,
  executingConditions: readonly ExecutingConditionSpec<TContext>[],
): void => {
  const seen = new Set<string>();
  for (const condition of executingConditions) {
    if (seen.has(condition.name)) {
      continue;
    }
    builder.executingCondition(condition.name, condition.predicate);
    seen.add(condition.name);
  }
};

export const withOperators = <TContext extends Context = Context>(
  label: string,
  enter: OperatorSpec<TContext>[],
  subgoal: GoalProgram,
  exit: OperatorSpec<TContext>[] = [],
  executingConditions: ExecutingConditionSpec<TContext>[] = [],
): WithOperators<TContext> => new WithOperators(label, enter, subgoal, exit, executingConditions);

type EmitOptions<TContext extends Context = Context> = {
  builder: DomainBuilder<TContext>;
  program: GoalProgram;
  handlers: GoalCompilationHandlers<TContext>;
  executingConditions: ExecutingConditionSpec<TContext>[];
};

const emitProgram = <TContext extends Context = Context>({
  builder,
  program,
  handlers,
  executingConditions,
}: EmitOptions<TContext>): void => {
  if (program instanceof DoInOrder) {
    builder.sequence(program.label);
    for (const step of program.steps) {
      emitProgram({ builder, program: step, handlers, executingConditions });
    }
    builder.end();
    return;
  }

  if (program instanceof DoInParallel) {
    builder.sequence(program.label);
    for (const branch of program.branches) {
      emitProgram({ builder, program: branch, handlers, executingConditions });
    }
    builder.end();
    return;
  }

  if (program instanceof Perform) {
    handlers.perform(builder, program, executingConditions);
    return;
  }

  if (program instanceof WhileConditionHolds) {
    const condition = program.condition;
    const activeConditions = executingConditions.concat([condition]);

    builder.select(`While ${condition.name}`);

    builder.sequence("While Condition Active")
      .condition(condition.name, condition.predicate);
    emitProgram({ builder, program: program.subgoal, handlers, executingConditions: activeConditions });
    builder.end();

    builder.sequence("While Condition Skipped")
      .condition(`Skip when ${condition.name} fails`, (context) => !condition.predicate(context))
      .action("While Condition Skip").do(() => TaskStatus.Success).end();
    builder.end();

    builder.end();
    return;
  }

  if (program instanceof WithOperators) {
    builder.sequence(program.label);
    for (const operator of program.enter) {
      builder.action(operator.name).do(operator.operation, operator.forceStop, operator.abort).end();
    }

    const subgoalConditions = executingConditions.concat(program.executingConditions);

    if (program.exit.length > 0) {
      builder.select(`${program.label} Scoped Subgoal`);

      builder.sequence(`${program.label} Success Path`);
      emitProgram({ builder, program: program.subgoal, handlers, executingConditions: subgoalConditions });
      for (const operator of program.exit) {
        builder.action(operator.name).do(operator.operation, operator.forceStop, operator.abort).end();
      }
      builder.end();

      builder.sequence(`${program.label} Failure Cleanup`);
      for (const operator of program.exit) {
        builder
          .action(`${operator.name} (cleanup)`)
          .do(operator.operation, operator.forceStop, operator.abort)
          .end();
      }
      builder.action(`${program.label} Cleanup Failure`).do(() => TaskStatus.Failure).end();
      builder.end();

      builder.end();
    } else {
      emitProgram({ builder, program: program.subgoal, handlers, executingConditions: subgoalConditions });
    }

    builder.end();
    return;
  }

  throw new Error(`Unhandled goal program node: ${program.constructor.name}`);
};

export const compileGoalProgram = <TContext extends Context = Context>(
  domainName: string,
  program: GoalProgram,
  handlers: GoalCompilationHandlers<TContext>,
  builderFactory: (name: string) => DomainBuilder<TContext> = (name) => new DomainBuilder<TContext>(name),
): Domain<TContext> => {
  const builder = builderFactory(domainName);
  emitProgram({ builder, program, handlers, executingConditions: [] });
  return builder.build();
};

export default {
  DoInOrder,
  DoInParallel,
  Perform,
  WhileConditionHolds,
  WithOperators,
  applyExecutingConditions,
  withOperators,
  compileGoalProgram,
};
