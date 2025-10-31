import type Context from "../context";
import DecompositionStatus from "../decompositionStatus";
import type { PlanResult } from "../types";
import type CompoundTask from "./compoundTask";

class Slot {
  public readonly SlotId: number;

  public Name: string;

  public Parent?: CompoundTask;

  public readonly Conditions: [] = [];

  private subtask: CompoundTask | null = null;

  constructor(slotId: number, name: string) {
    this.SlotId = slotId;
    this.Name = name;
  }

  isValid(_context: Context): boolean {
    return this.subtask !== null;
  }

  addCondition(): never {
    throw new Error("Slot tasks do not support conditions");
  }

  setSubtask(task: CompoundTask): boolean {
    if (this.subtask) {
      return false;
    }

    this.subtask = task;
    this.subtask.Parent = this.Parent;

    return true;
  }

  clear(): void {
    this.subtask = null;
  }

  decompose(context: Context, startIndex: number): PlanResult {
    if (this.subtask) {
      return this.subtask.decompose(context, startIndex);
    }

    return { plan: [], status: DecompositionStatus.Failed };
  }
}

export default Slot;
