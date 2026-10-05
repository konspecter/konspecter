import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { SyncEngine, SyncStatus } from "../../infrastructure/sync/sync-engine";
import { SyncIndicator } from "./SyncIndicator";

function syncIn(state: SyncStatus["state"], blocked = 0): SyncEngine {
  const status = { state, blocked } as SyncStatus;
  return { subscribe: () => () => undefined, getStatus: () => status } as unknown as SyncEngine;
}

function renderIndicator(sync: SyncEngine) {
  render(
    <MemoryRouter>
      <SyncIndicator sync={sync} />
    </MemoryRouter>,
  );
}

describe("SyncIndicator", () => {
  it("says nothing without a connection: the antenna shows it", () => {
    renderIndicator(syncIn("offline"));

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links to settings when sync fails or holds notes back", () => {
    renderIndicator(syncIn("error"));
    expect(screen.getByRole("link", { name: "Sync: Sync failed" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("says when the server disconnected this device", () => {
    renderIndicator(syncIn("disconnected"));
    expect(screen.getByRole("link", { name: "Sync: Sync stopped" })).toBeInTheDocument();
  });

  it("says when sync waits for the passphrase", () => {
    renderIndicator(syncIn("locked"));
    expect(screen.getByRole("link", { name: "Sync: Sync locked" })).toBeInTheDocument();
  });

  it("counts the notes held back", () => {
    renderIndicator(syncIn("offline", 2));
    expect(screen.getByRole("link")).toHaveTextContent("2 not synced");
  });
});
