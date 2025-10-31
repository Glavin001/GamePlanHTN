export const ContextState = {
  Executing: "executing",
  Planning: "planning",
} as const;

export type ContextStateValue = typeof ContextState[keyof typeof ContextState];

export default ContextState;
