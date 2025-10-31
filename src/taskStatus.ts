// Portions of this file are derived from FluidHTN (MIT License)
// Copyright (c) 2019 Pål Trefall
// https://github.com/ptrefall/fluid-hierarchical-task-network

export const TaskStatus = {
  Success: "success",
  Continue: "continue",
  Failure: "failure",
} as const;

export type TaskStatusValue = typeof TaskStatus[keyof typeof TaskStatus];

export default TaskStatus;
