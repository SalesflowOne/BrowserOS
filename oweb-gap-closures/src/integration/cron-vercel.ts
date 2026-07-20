/**
 * Vercel cron handler — tick scheduled jobs across orgs.
 */
import type { CronService } from "../scheduler/cron-lite.server.js";

export type CronVercelHandlerDeps = {
  cronSecret?: string;
  cron: CronService;
  /** Reload jobs from DB on each tick */
  reloadJobs?: () => Promise<void>;
};

export async function handleVercelCronRequest(
  request: Request,
  deps: CronVercelHandlerDeps,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (deps.cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${deps.cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  if (deps.reloadJobs) {
    await deps.reloadJobs();
  }

  const jobs = deps.cron.list();
  let triggered = 0;
  for (const job of jobs) {
    if (job.enabled) {
      deps.cron.runNow(job.id);
      triggered += 1;
    }
  }

  return Response.json({
    ok: true,
    triggered,
    jobCount: jobs.length,
    at: new Date().toISOString(),
  });
}

/** Example vercel.json cron entry */
export const VERCEL_CRON_CONFIG = {
  crons: [
    {
      path: "/api/cron/oweb-jobs",
      schedule: "* * * * *",
    },
  ],
};
