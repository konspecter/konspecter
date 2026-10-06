import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import App from "./root";

function renderHeader(account: { email: string | null; name: string }) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale: "en", theme: "system", accounts: true, ...account }),
      children: [{ index: true, Component: () => null }],
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

it("greets a named account by its name, with the address in the hint", async () => {
  renderHeader({ email: "ann@example.com", name: "Ann Lee" });
  const link = await screen.findByRole("link", { name: "Ann Lee" });
  expect(link).toHaveAttribute("href", "/settings");
  expect(link).toHaveAttribute("title", "Account settings (ann@example.com)");
  expect(screen.queryByText("ann@example.com")).toBeNull();
});

it("shows the address when the account has no name", async () => {
  renderHeader({ email: "ann@example.com", name: "" });
  expect(await screen.findByRole("link", { name: "ann@example.com" })).toBeInTheDocument();
});

it("offers the languages in a dropdown, each by its own name", async () => {
  renderHeader({ email: null, name: "" });
  const language = await screen.findByRole("combobox", { name: "Language" });
  expect(language).toHaveValue("en");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "English",
    "Русский",
  ]);
  expect(language.closest("form")).toHaveAttribute("action", "/preferences");
});
