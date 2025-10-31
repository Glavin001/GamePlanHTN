// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

export const DecompositionStatus = {
  Failed: "failed",
  Rejected: "rejected",
  Succeeded: "succeeded",
  Partial: "partial",
} as const;

export type DecompositionStatusValue = typeof DecompositionStatus[keyof typeof DecompositionStatus];

export default DecompositionStatus;
