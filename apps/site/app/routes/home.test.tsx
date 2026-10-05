import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import App from "../root";
import type { Platform } from "../platform";
import Home from "./home";

function renderHome(
  locale: "en" | "ru",
  downloads: { platform: Platform; url: string }[],
  suggested: Platform | null = null,
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale, theme: "system" }),
      children: [
        { index: true, Component: Home as never, loader: () => ({ downloads, suggested }) },
      ],
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

it("shows the landing page with the configured downloads", async () => {
  renderHome(
    "en",
    [
      { platform: "macos", url: "https://example.com/k.dmg" },
      { platform: "web", url: "https://app.example.com/" },
    ],
    "macos",
  );

  expect(
    await screen.findByRole("heading", { level: 1, name: "Technical conspects in plain Markdown" }),
  ).toBeInTheDocument();
  for (const link of screen.getAllByRole("link", { name: "Download for macOS" })) {
    expect(link).toHaveAttribute("href", "https://example.com/k.dmg");
  }
  expect(screen.getAllByRole("link", { name: "Open in the browser" })[0]).toHaveAttribute(
    "href",
    "https://app.example.com/",
  );
  const downloads = screen.getByRole("region", { name: "Get Konspecter" });
  expect(within(downloads).getAllByRole("listitem")).toHaveLength(2);
  expect(
    screen.getByRole("figure", { name: "A conspect as Konspecter stores it" }),
  ).toHaveTextContent("title: Reading EXPLAIN ANALYZE");
});

it("leaves out the downloads when none are configured", async () => {
  renderHome("en", []);
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("region", { name: "Get Konspecter" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
});

it("speaks Russian, with switches to English and the other theme", async () => {
  renderHome("ru", [{ platform: "linux", url: "https://example.com/k.AppImage" }]);
  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Технические конспекты в обычном Markdown",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Скачать" })).toHaveAttribute("href", "#download");
  expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("value", "en");
  expect(screen.getByRole("button", { name: "Включить тёмную тему" })).toHaveAttribute(
    "value",
    "dark",
  );
  expect(screen.getByRole("link", { name: "Главная Konspecter" })).toHaveAttribute("href", "/");
});
