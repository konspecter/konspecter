import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WipedBanner } from "./WipedBanner";

describe("WipedBanner", () => {
  it("says the device was wiped until it is closed", async () => {
    render(<WipedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/wiped/i);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("status")).toBeNull();
  });
});
