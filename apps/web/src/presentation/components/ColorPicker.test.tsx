import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorPicker } from "./ColorPicker";
import { recentColors, rememberColor } from "./note-color";

describe("ColorPicker", () => {
  it("shows the note's colour on its swatch", () => {
    render(<ColorPicker id="a" color="#4f8fd6" onPick={vi.fn()} />);
    const swatch = screen.getByRole("button", { name: "Colour" }).firstElementChild;

    expect(swatch).toHaveStyle({ "--cover-color": "#4f8fd6" });
  });

  it("picks from the spectrum with the keyboard and remembers the colour", async () => {
    const onPick = vi.fn();
    render(<ColorPicker id="a" color="#ff0000" onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    const spectrum = screen.getByRole("slider", { name: "Colour spectrum" });
    expect(spectrum).toHaveFocus();
    expect(spectrum).toHaveAttribute("aria-valuetext", "#ff0000");

    // Six steps of 5° to the right: hue 30, orange.
    await userEvent.keyboard("{ArrowRight>6/}{Enter}");

    expect(onPick).toHaveBeenCalledWith("#ff8000");
    expect(recentColors()).toEqual(["#ff8000"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Colour" })).toHaveFocus();
  });

  it("offers nine slots under the spectrum, the recent colours first", async () => {
    rememberColor("#112233");
    rememberColor("#445566");
    const onPick = vi.fn();
    render(<ColorPicker id="a" color="#112233" onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    const recent = screen.getByRole("group", { name: "Recent colours" });
    expect(recent.children).toHaveLength(9);
    expect(screen.getByRole("button", { name: "#112233" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "#445566" }));

    expect(onPick).toHaveBeenCalledWith("#445566");
    expect(recentColors()).toEqual(["#445566", "#112233"]);
  });

  it("goes back to the default colour", async () => {
    const onPick = vi.fn();
    const { rerender } = render(<ColorPicker id="a" color={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    expect(screen.queryByRole("button", { name: "Default colour" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    rerender(<ColorPicker id="a" color="#4f8fd6" onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    await userEvent.click(screen.getByRole("button", { name: "Default colour" }));

    expect(onPick).toHaveBeenCalledWith(null);
    expect(recentColors()).toEqual([]);
  });

  it("closes without picking on Escape or a click elsewhere", async () => {
    const onPick = vi.fn();
    render(<ColorPicker id="a" color={null} onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    await userEvent.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
