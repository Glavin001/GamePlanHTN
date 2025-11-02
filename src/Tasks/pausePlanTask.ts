import type Context from "../context";
import type { WorldStateBase } from "../context";
import type CompoundTask from "./compoundTask";

export interface PausePlanTaskConfig {
  name: string;
}

class PausePlanTask {
  public readonly Name: string;

  public readonly Conditions: [] = [];

  public readonly Effects: [] = [];

  public Parent?: CompoundTask<Context<WorldStateBase>>;

  constructor(props: PausePlanTaskConfig = { name: "PausePlanTask" }) {
    this.Name = props.name;
  }

  addCondition(): never {
    throw new Error("Pause Plan Tasks cannot have conditions");
  }

  addEffect(): never {
    throw new Error("Pause Plan Tasks cannot have effects");
  }

  applyEffects(): void {
    // No-op
  }

  isValid(): boolean {
    return true;
  }
}

export default PausePlanTask;
