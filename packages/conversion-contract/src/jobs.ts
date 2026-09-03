export const JOB_STATES = [
  "queued",
  "probing",
  "ready",
  "converting",
  "done",
  "failed",
  "cancelled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

const transitions: Readonly<Record<JobState, readonly JobState[]>> = {
  cancelled: [],
  converting: ["done", "failed", "cancelled"],
  done: [],
  failed: ["queued"],
  probing: ["ready", "failed", "cancelled"],
  queued: ["probing", "cancelled"],
  ready: ["converting", "cancelled"],
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return transitions[from].includes(to);
}

export function assertJobTransition(from: JobState, to: JobState): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid conversion job transition: ${from} -> ${to}.`);
  }
}
