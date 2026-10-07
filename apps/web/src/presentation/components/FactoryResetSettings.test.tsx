import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FactoryReset } from "../app/factory-reset";
import { FactoryResetSettings } from "./FactoryResetSettings";

function fakeReset(count: number) {
  const run = vi.fn(() => Promise.resolve());
  const reset: FactoryReset = { appNotes: () => Promise.resolve(count), run };
  return { reset, run };
}

describe("FactoryResetSettings", () => {
  it("names the conspects it erases and resets once confirmed", async () => {
    const { reset, run } = fakeReset(3);
    render(<FactoryResetSettings reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: "Reset Konspecter…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reset Konspecter?" });
    expect(dialog).toHaveTextContent("The 3 conspects in the app library are erased");
    expect(dialog).toHaveTextContent("Markdown files outside the app are not touched.");
    await userEvent.click(screen.getByRole("button", { name: "Erase and reset" }));

    expect(run).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Resetting…");
  });

  it("does nothing when cancelled", async () => {
    const { reset, run } = fakeReset(0);
    render(<FactoryResetSettings reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: "Reset Konspecter…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reset Konspecter?" });
    expect(dialog).toHaveTextContent(
      "The settings, the sync connection and reading positions are erased.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("says so when the reset fails", async () => {
    const reset: FactoryReset = {
      appNotes: () => Promise.resolve(1),
      run: () => Promise.reject(new Error("blocked")),
    };
    render(<FactoryResetSettings reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: "Reset Konspecter…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Erase and reset" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset Konspecter…" })).toBeEnabled();
  });
});
