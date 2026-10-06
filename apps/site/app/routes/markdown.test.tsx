import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import App from "../root";
import Markdown from "./markdown";

function renderCheatsheet(locale: "en" | "ru") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale, theme: "system" }),
      children: [{ path: "markdown", Component: Markdown as never }],
    },
  ]);
  render(<Stub initialEntries={["/markdown"]} />);
}

it("shows each mark as typed and as shown, by section", async () => {
  renderCheatsheet("en");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Markdown cheatsheet" }),
  ).toBeInTheDocument();

  const text = screen.getByRole("table", { name: "Text" });
  const bold = within(text).getByRole("row", { name: /^Bold/ });
  expect(within(bold).getByText("**bold**")).toBeInTheDocument();
  expect(within(bold).getByText("bold", { selector: "strong" })).toBeInTheDocument();

  const lists = screen.getByRole("table", { name: "Lists" });
  const tasks = within(lists).getByRole("row", { name: /^Checklist/ });
  expect(
    within(tasks)
      .getAllByRole("checkbox")
      .map((box) => (box as HTMLInputElement).checked),
  ).toEqual([true, false]);

  const tags = screen.getByRole("table", { name: "Tags" });
  expect(within(tags).getByText("#recipes#baking")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "The Markdown Guide" })).toHaveAttribute(
    "href",
    "https://www.markdownguide.org/basic-syntax/",
  );
});

it("speaks Russian, with Russian examples and a Russian guide", async () => {
  renderCheatsheet("ru");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Шпаргалка по Markdown" }),
  ).toBeInTheDocument();
  expect(screen.getByText("**жирный**")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Статья на Доке" })).toHaveAttribute(
    "href",
    "https://doka.guide/tools/markdown/",
  );
});
