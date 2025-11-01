export const EffectType = {
  PlanAndExecute: "planandexecute",
  Permanent: "permanent",
  PlanOnly: "planonly",
} as const;

export type EffectTypeValue = typeof EffectType[keyof typeof EffectType];

export default EffectType;
