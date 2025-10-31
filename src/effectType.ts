// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

export const EffectType = {
  PlanAndExecute: "planandexecute",
  Permanent: "permanent",
  PlanOnly: "planonly",
} as const;

export type EffectTypeValue = typeof EffectType[keyof typeof EffectType];

export default EffectType;
