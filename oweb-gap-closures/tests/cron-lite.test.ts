import { describe, expect, it, vi } from "vitest";

import { createCronService } from "../src/scheduler/cron-lite.server.js";

describe("cron-lite", () => {
  it("runs job on every schedule", async () => {
    vi.useFakeTimers();
    const runner = vi.fn();
    const cron = createCronService(runner);

    cron.add({
      id: "job1",
      orgId: "org_1",
      name: "ping",
      enabled: true,
      schedule: { kind: "every", intervalMs: 1000 },
      threadKey: "cron:org_1:ping",
      message: "scheduled ping",
    });

    await vi.advanceTimersByTimeAsync(1100);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ message: "scheduled ping", jobId: "job1" }),
    );

    cron.stopAll();
    vi.useRealTimers();
  });

  it("lists jobs by org", () => {
    const cron = createCronService(vi.fn());
    cron.add({
      id: "a",
      orgId: "org_1",
      name: "a",
      enabled: true,
      schedule: { kind: "every", intervalMs: 60_000 },
      threadKey: "t",
      message: "m",
    });
    expect(cron.list("org_1")).toHaveLength(1);
    expect(cron.list("org_2")).toHaveLength(0);
    cron.stopAll();
  });
});
