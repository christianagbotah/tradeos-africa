import { describe, expect, it } from "vitest";
import type { DatabaseClient } from "../src/db.js";
import { issueSession } from "../src/auth/security.js";

describe("auth session device identity", () => {
  it("returns the authenticated device key as the sync clientId", async () => {
    const client = {
      query: async () => ({ rows: [], rowCount: 1 }),
    } as unknown as DatabaseClient;

    const session = await issueSession(client, {
      userId: "00000000-0000-0000-0000-000000000001",
      platform: "WEB",
      deviceKey: "web-device-123",
      appVersion: "0.0.1",
    });

    expect(session.clientId).toBe("web-device-123");
  });
});
