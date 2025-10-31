export const DecompositionStatus = {
  Failed: "failed",
  Rejected: "rejected",
  Succeeded: "succeeded",
  Partial: "partial",
} as const;

export type DecompositionStatusValue = typeof DecompositionStatus[keyof typeof DecompositionStatus];

export default DecompositionStatus;
