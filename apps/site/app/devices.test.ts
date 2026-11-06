import { connectedDevices, parseClient, parseDevices, timeAgo } from "./devices";

it("reads the API's devices and leaves out malformed ones", () => {
  const devices = parseDevices({
    devices: [
      {
        id: "d1",
        name: "Firefox on Linux",
        platform: "linux",
        client_version: "0.2.0",
        created_at: "2026-10-01T10:00:00Z",
        last_used_at: "2026-10-05T10:00:00Z",
        last_sync_at: null,
        wipe_requested_at: null,
      },
      {
        id: "d3",
        name: "Old phone",
        platform: "android",
        created_at: "2026-09-01T10:00:00Z",
        wipe_requested_at: "2026-10-05T09:00:00Z",
      },
      { id: "d2", name: "No date", platform: "web" },
      { name: "No id", created_at: "2026-10-01T10:00:00Z" },
      "nonsense",
    ],
  });
  expect(devices).toEqual([
    {
      id: "d1",
      name: "Firefox on Linux",
      platform: "linux",
      clientVersion: "0.2.0",
      createdAt: "2026-10-01T10:00:00Z",
      lastUsedAt: "2026-10-05T10:00:00Z",
      lastSyncAt: null,
      wipeRequestedAt: null,
    },
    {
      id: "d3",
      name: "Old phone",
      platform: "android",
      clientVersion: "",
      createdAt: "2026-09-01T10:00:00Z",
      lastUsedAt: null,
      lastSyncAt: null,
      wipeRequestedAt: "2026-10-05T09:00:00Z",
    },
  ]);
  expect(connectedDevices(devices).map((device) => device.id)).toEqual(["d1"]);
  expect(parseDevices(null)).toEqual([]);
});

it("treats an unknown platform as other", () => {
  expect(parseClient({ name: "Haiku app", platform: "haiku" })).toEqual({
    name: "Haiku app",
    platform: "other",
    clientVersion: "",
  });
  expect(parseClient({ platform: "web" })).toBeNull();
});

it("says how long ago something was, in the page's language", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  expect(timeAgo("2026-10-05T11:59:30Z", now, "en")).toBe("now");
  expect(timeAgo("2026-10-05T11:55:00Z", now, "en")).toBe("5 minutes ago");
  expect(timeAgo("2026-10-04T11:00:00Z", now, "en")).toBe("yesterday");
  expect(timeAgo("2026-10-05T09:00:00Z", now, "ru")).toBe("3 часа назад");
  // A clock a little ahead is not "in the future".
  expect(timeAgo("2026-10-05T12:00:05Z", now, "en")).toBe("now");
});
