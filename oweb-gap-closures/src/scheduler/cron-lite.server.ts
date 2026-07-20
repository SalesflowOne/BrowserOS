/**
 * Cron-lite scheduler — minimal OpenClaw cron parity for OWeb.
 * Enqueues chat runs on schedule without full isolated-agent pipeline.
 */

export type CronSchedule =
  | { kind: "every"; intervalMs: number }
  | { kind: "at"; at: string }
  | { kind: "cron"; expression: string; timezone?: string };

export type CronJob = {
  id: string;
  orgId: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  threadKey: string;
  message: string;
  lastRunAt?: string;
  nextRunAt?: string;
};

export type CronRunner = (req: {
  orgId: string;
  threadKey: string;
  message: string;
  jobId: string;
}) => Promise<void>;

type JobState = CronJob & { timer?: ReturnType<typeof setTimeout> };

export function createCronService(runner: CronRunner) {
  const jobs = new Map<string, JobState>();

  function computeNextRun(schedule: CronSchedule, from = Date.now()): number | null {
    switch (schedule.kind) {
      case "every":
        return from + schedule.intervalMs;
      case "at": {
        const at = Date.parse(schedule.at);
        return at > from ? at : null;
      }
      case "cron":
        // Minimal: treat as every 60s placeholder — wire to cron-parser in OWeb prod
        return from + 60_000;
      default:
        return null;
    }
  }

  function scheduleJob(job: JobState) {
    if (job.timer) clearTimeout(job.timer);
    if (!job.enabled) return;

    const next = computeNextRun(job.schedule);
    if (next == null) return;

    job.nextRunAt = new Date(next).toISOString();
    const delay = Math.max(0, next - Date.now());
    job.timer = setTimeout(() => {
      void (async () => {
        job.lastRunAt = new Date().toISOString();
        try {
          await runner({
            orgId: job.orgId,
            threadKey: job.threadKey,
            message: job.message,
            jobId: job.id,
          });
        } catch (err) {
          console.error(`[cron-lite] job ${job.id} failed`, err);
        }
        if (job.schedule.kind === "every") scheduleJob(job);
        else if (job.schedule.kind === "cron") scheduleJob(job);
      })();
    }, delay);
    job.timer.unref?.();
  }

  return {
    add(job: Omit<CronJob, "lastRunAt" | "nextRunAt">) {
      const state: JobState = { ...job };
      jobs.set(job.id, state);
      scheduleJob(state);
      return state;
    },
    remove(id: string) {
      const job = jobs.get(id);
      if (job?.timer) clearTimeout(job.timer);
      jobs.delete(id);
    },
    update(id: string, patch: Partial<Pick<CronJob, "enabled" | "schedule" | "message">>) {
      const job = jobs.get(id);
      if (!job) return null;
      Object.assign(job, patch);
      scheduleJob(job);
      return job;
    },
    list(orgId?: string) {
      return [...jobs.values()]
        .filter((j) => !orgId || j.orgId === orgId)
        .map(({ timer: _t, ...j }) => j);
    },
    runNow(id: string) {
      const job = jobs.get(id);
      if (!job) return false;
      void runner({
        orgId: job.orgId,
        threadKey: job.threadKey,
        message: job.message,
        jobId: job.id,
      });
      return true;
    },
    stopAll() {
      for (const job of jobs.values()) {
        if (job.timer) clearTimeout(job.timer);
      }
      jobs.clear();
    },
  };
}

export type CronService = ReturnType<typeof createCronService>;
