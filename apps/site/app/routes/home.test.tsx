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
  sync: "free" | "paid" | "none" = pricing ? "paid" : "free",
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
          loader: () => ({ downloads, suggested, pricing, sync }),
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
    within(downloads).getByRole("link", { name: "Installing help, every release and more" }),
  ).toHaveAttribute("href", "/download");
  // The note on opening the macOS app sits in the macOS row.
  expect(within(downloads).getAllByRole("listitem")[0]).toHaveTextContent(
    "click Open Anyway in System Settings",
  );
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

it("offers your own way and the paid sync, with its price and a way to try it", async () => {
  renderHome("en", [{ platform: "web", url: "https://app.example.com/" }], null, {
    amount: 3,
    currency: "USD",
    period: "1m",
    trial: "14d",
  });
  const sync = await screen.findByRole("region", { name: "Sync between your devices" });
  expect(within(sync).getByRole("heading", { name: "Your own way" })).toBeInTheDocument();
  expect(sync).toHaveTextContent("Keep that folder in iCloud Drive");
  expect(within(sync).getByRole("link", { name: "Self-hosting guide" })).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/blob/main/docs/self-hosting.md",
  );
  expect(within(sync).getByRole("heading", { name: "Konspecter sync" })).toBeInTheDocument();
  expect(sync).toHaveTextContent("$3 every month");
  expect(sync).toHaveTextContent("Cancel any time. The first 14 days are free.");
  expect(within(sync).getByRole("link", { name: "Try sync for free" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(within(sync).getByRole("link", { name: "Prices and terms" })).toHaveAttribute(
    "href",
    "/terms",
  );
});

it("offers the free sync beside your own way, and speaks of both", async () => {
  renderHome("en", []);
  const sync = await screen.findByRole("region", { name: "Sync between your devices" });
  expect(sync).toHaveTextContent("through Konspecter sync");
  expect(within(sync).getByRole("heading", { name: "Konspecter sync" })).toBeInTheDocument();
  expect(within(sync).getByText("No account")).toBeInTheDocument();
  expect(within(sync).getAllByText("Free")).toHaveLength(1);
  expect(within(sync).getByRole("link", { name: "Connect your devices" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(within(sync).queryByRole("link", { name: "Prices and terms" })).not.toBeInTheDocument();
  expect(
    screen.getByText(/^Connect your computer, phone and browser.*your own way/),
  ).toBeInTheDocument();
  expect(screen.getByText(/^Conspects are locked with a passphrase/)).toBeInTheDocument();
});

it("offers only your own way where the server has no sync", async () => {
  renderHome("ru", [], null, null, "none");
  const sync = await screen.findByRole("region", { name: "Синхронизация между устройствами" });
  expect(within(sync).getByRole("heading", { name: "По-своему" })).toBeInTheDocument();
  expect(
    within(sync).queryByRole("heading", { name: "Синхронизация Konspecter" }),
  ).not.toBeInTheDocument();
  expect(sync).not.toHaveTextContent("через синхронизацию Konspecter");
  expect(screen.queryByText(/QR-код/)).not.toBeInTheDocument();
  expect(screen.queryByText(/шифруются паролем/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/синхронизируйте их по-своему — через облачный диск/),
  ).toBeInTheDocument();
});

it("leaves out the downloads when none are configured", async () => {
  renderHome("en", []);
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("region", { name: "Get Konspecter" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Download for/ })).not.toBeInTheDocument();
});

it("speaks Russian, with the language dropdown and the other theme", async () => {
  renderHome("ru", [{ platform: "linux", url: "https://example.com/k.AppImage" }]);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Познал. Сохранил. Вернулся." }),
  ).toBeInTheDocument();
  // The hero's button leads to the downloads; the footer's link, to their page.
  expect(
    screen.getAllByRole("link", { name: "Скачать" }).map((link) => link.getAttribute("href")),
  ).toEqual(["#download", "/ru/download"]);
  // The note on opening the macOS app comes only with a macOS download.
  expect(screen.queryByText(/Всё равно открыть/)).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Язык" })).toHaveValue("ru");
  expect(screen.getByRole("button", { name: "Включить тёмную тему" })).toHaveAttribute(
    "value",
    "dark",
  );
  expect(screen.getByRole("link", { name: "Главная Konspecter" })).toHaveAttribute("href", "/ru/");
});
