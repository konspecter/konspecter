import { render, screen } from "@testing-library/react";
import type { SyncEngine, SyncStatus } from "../../infrastructure/sync/sync-engine";
import { Activity } from "../app/activity";
import { Antenna } from "./Antenna";

function syncIn(state: SyncStatus["state"]): SyncEngine {
  const status = { state } as SyncStatus;
  return { subscribe: () => () => undefined, getStatus: () => status } as unknown as SyncEngine;
}

describe("Antenna", () => {
  it("rests while nothing moves", () => {
    render(<Antenna activity={new Activity()} sync={syncIn("idle")} />);

    expect(screen.getByRole("img")).toHaveAttribute("data-state", "idle");
    expect(screen.getByRole("img")).toHaveAccessibleName("Everything is stored on this device");
  });

  it("is crossed out while sync has no connection", () => {
    render(<Antenna activity={new Activity()} sync={syncIn("offline")} />);

    const antenna = screen.getByRole("img");
    expect(antenna).toHaveAttribute("data-state", "offline");
    expect(antenna).toHaveAccessibleName(
      "No connection: notes are stored on this device and sync later",
    );
  });

  it("transmits while syncing", () => {
    render(<Antenna activity={new Activity()} sync={syncIn("syncing")} />);

    expect(screen.getByRole("img")).toHaveAttribute("data-state", "active");
  });
});
