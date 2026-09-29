import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import type { UpdateSource } from "../app/updates";
import { UpdateBanner } from "./UpdateBanner";

function fakeUpdates() {
  let listener: (() => void) | null = null;
  const source: UpdateSource = {
    subscribe(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    apply: vi.fn(),
  };
  return {
    source,
    announce: () => {
      act(() => {
        listener?.();
      });
    },
  };
}

describe("UpdateBanner", () => {
  it("stays hidden until an update is waiting, then reloads on request", async () => {
    const { source, announce } = fakeUpdates();
    render(<UpdateBanner updates={source} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    announce();
    expect(screen.getByRole("status")).toHaveTextContent(
      "A new version of Konspecter is available.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(source.apply).toHaveBeenCalled();
  });

  it("can be postponed", async () => {
    const { source, announce } = fakeUpdates();
    render(<UpdateBanner updates={source} />);
    announce();

    await userEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(source.apply).not.toHaveBeenCalled();
  });
});
