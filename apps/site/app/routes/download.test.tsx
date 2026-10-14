import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import App from "../root";
import type { Platform } from "../platform";
import Download from "./download";

function renderDownload(
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
        {
          path: "download",
          Component: Download as never,
          loader: () => ({ downloads, suggested }),
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/download"]} />);
}

it("lists the downloads with the visitor's first, and what helps after them", async () => {
  renderDownload(
    "en",
    [
      { platform: "macos", url: "https://example.com/k.dmg" },
      { platform: "windows", url: "https://example.com/k.exe" },
      { platform: "android", url: "https://example.com/k.apk" },
    ],
    "windows",
  );

  expect(
    await screen.findByRole("heading", { level: 1, name: "Download Konspecter" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Download for Windows" })).toHaveClass("button-primary");
  expect(screen.getByRole("link", { name: "Download for macOS" })).not.toHaveClass(
    "button-primary",
  );

  const mac = screen.getByRole("region", { name: "Opening the Mac app the first time" });
  expect(within(mac).getByText(/xattr -dr com.apple.quarantine/)).toBeInTheDocument();
  // The section says it all; the macOS row does not repeat it.
  expect(screen.queryByText(/click Open Anyway in System Settings/)).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Installing on Android" })).toBeInTheDocument();
  // No web app is offered, so nothing is said about installing it.
  expect(screen.queryByRole("region", { name: "In the browser" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Where your conspects are kept" })).toBeInTheDocument();

  const more = screen.getByRole("region", { name: "More" });
  expect(
    within(more).getByRole("link", { name: "Every release and what changed in it" }),
  ).toHaveAttribute("href", "https://github.com/konspecter/konspecter/releases");
  expect(within(more).getByRole("link", { name: "Markdown cheatsheet" })).toHaveAttribute(
    "href",
    "/markdown",
  );
  expect(within(more).getByRole("link", { name: "Run a sync server of your own" })).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/blob/main/docs/self-hosting.md",
  );
});

it("points to the releases on GitHub where no download is configured, in Russian", async () => {
  renderDownload("ru", []);

  expect(
    await screen.findByRole("heading", { level: 1, name: "Скачать Konspecter" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^Скачать для/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "странице релизов на GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/releases",
  );
  expect(screen.queryByRole("region", { name: "Первый запуск на Mac" })).not.toBeInTheDocument();
  const more = screen.getByRole("region", { name: "Ещё" });
  expect(within(more).getByRole("link", { name: "Шпаргалка по Markdown" })).toHaveAttribute(
    "href",
    "/ru/markdown",
  );
});
