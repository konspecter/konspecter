import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import App from "../root";
import type { Platform } from "../platform";
import Home from "./home";

function renderHome(
  locale: "en" | "ru",
  downloads: { platform: Platform; url: string }[],
  suggested: Platform | null = null,
  pricing: { amount: number; currency: string; period: string; trial: string } | null = null,
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale, theme: "system" }),
      children: [
        {
          index: true,
          Component: Home as never,
          loader: () => ({ downloads, suggested, pricing }),
        },
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
    await screen.findByRole("heading", {
      level: 1,
      name: "A notebook for everything worth keeping",
    }),
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
  ).toHaveTextContent("title: Grandma's apple pie");
  const markdown = screen.getByRole("region", { name: "Konspecter speaks Markdown" });
  expect(within(markdown).getByRole("link", { name: "Markdown cheatsheet" })).toHaveAttribute(
    "href",
    "/markdown",
  );
  expect(within(markdown).getByRole("link", { name: "Learn Markdown" })).toHaveAttribute(
    "href",
    "https://www.markdownguide.org/basic-syntax/",
  );
  expect(within(markdown).getByRole("list", { name: "Markdown marks" })).toHaveTextContent(
    "**bold**",
  );
});

it("shows what sync costs where it is paid, with a way to try it", async () => {
  renderHome("en", [{ platform: "web", url: "https://app.example.com/" }], null, {
    amount: 3,
    currency: "USD",
    period: "1m",
    trial: "14d",
  });
  const pricing = await screen.findByRole("region", { name: "What it costs" });
  expect(pricing).toHaveTextContent("The appsFree");
  expect(pricing).toHaveTextContent("$3 every month");
  expect(pricing).toHaveTextContent("The first 14 days are free.");
  expect(within(pricing).getByRole("link", { name: "Try sync for free" })).toHaveAttribute(
    "href",
    "/settings",
  );
});

it("leaves out the downloads when none are configured", async () => {
  renderHome("en", []);
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("region", { name: "Get Konspecter" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "What it costs" })).not.toBeInTheDocument();
});

it("speaks Russian, with the language dropdown and the other theme", async () => {
  renderHome("ru", [{ platform: "linux", url: "https://example.com/k.AppImage" }]);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Понял. Сохранил. Вернулся." }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Скачать" })).toHaveAttribute("href", "#download");
  expect(screen.getByRole("combobox", { name: "Язык" })).toHaveValue("ru");
  expect(screen.getByRole("button", { name: "Включить тёмную тему" })).toHaveAttribute(
    "value",
    "dark",
  );
  expect(screen.getByRole("link", { name: "Главная Konspecter" })).toHaveAttribute("href", "/");
});
