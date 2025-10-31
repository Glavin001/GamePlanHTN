import type PrimitiveTask from "./Tasks/primitiveTask";
import type { DecompositionStatusValue } from "./decompositionStatus";

export interface PlanResult {
  plan: PrimitiveTask[];
  status: DecompositionStatusValue;
}
