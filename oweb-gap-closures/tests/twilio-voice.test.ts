import { describe, expect, it, vi } from "vitest";

import {
  createTwilioVoiceMcpTools,
  initiateTwilioCall,
} from "../src/mcp/twilio-voice.server.js";

const config = {
  accountSid: "ACtest",
  authToken: "secret",
  fromNumber: "+15550001111",
  twimlUrl: "https://example.com/twiml",
};

describe("twilio-voice", () => {
  it("initiates call via Twilio REST API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sid: "CA123",
        status: "queued",
        to: "+15559998888",
        from: "+15550001111",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const call = await initiateTwilioCall(config, "+15559998888");
    expect(call.sid).toBe("CA123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/Accounts/ACtest/Calls.json");
    expect(opts.method).toBe("POST");

    vi.unstubAllGlobals();
  });

  it("exposes MCP tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "CA456", status: "completed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools = createTwilioVoiceMcpTools(config);
    const endCall = tools.find((t) => t.name === "end_call")!;
    const result = (await endCall.handler({ callSid: "CA456" })) as { status: string };
    expect(result.status).toBe("completed");

    vi.unstubAllGlobals();
  });
});
