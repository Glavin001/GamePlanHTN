export const TaskStatus = {
  Success: "success",
  Continue: "continue",
  Failure: "failure",
} as const;

export type TaskStatusValue = typeof TaskStatus[keyof typeof TaskStatus];

export default TaskStatus;
