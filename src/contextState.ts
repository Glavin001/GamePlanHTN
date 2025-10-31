// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

export const ContextState = {
  Executing: "executing",
  Planning: "planning",
} as const;

export type ContextStateValue = typeof ContextState[keyof typeof ContextState];

export default ContextState;
