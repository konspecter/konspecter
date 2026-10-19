import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import App from "../root";
import TagChain from "./tag-chain";

function renderTagChain(locale: "en" | "ru") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale, theme: "system" }),
      children: [{ path: "tag-chain", Component: TagChain as never }],
    },
  ]);
  render(<Stub initialEntries={["/tag-chain"]} />);
}

const folders = (tree: HTMLElement) =>
  within(tree)
    .getAllByRole("listitem")
    .map((item) => item.firstChild?.textContent);

it("shows how a chain builds the tree, and one tag under several topics", async () => {
  renderTagChain("en");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Tag-Chain: tags that build the tree" }),
  ).toBeInTheDocument();

  const chain = screen.getByRole("region", { name: "Each # adds a level" });
  expect(within(chain).getByText("#recipes#baking#bread")).toBeInTheDocument();
  expect(folders(within(chain).getByRole("list", { name: "Tree" }))).toEqual([
    "Recipes",
    "Baking",
    "Bread",
  ]);

  const shared = screen.getByRole("region", { name: "One tag, many places" });
  const tree = within(shared).getByRole("list", { name: "Tree" });
  expect(folders(tree)).toEqual(["Recipes", "Italy", "Travel", "Italy"]);
  expect(within(tree).getByText("Pasta, Phrasebook")).toBeInTheDocument();
  expect(within(tree).getByText("Phrasebook, Rome")).toBeInTheDocument();
});

it("links to the specification and the rules on GitHub", async () => {
  renderTagChain("en");
  const spec = await screen.findByRole("region", { name: "The full specification" });
  expect(within(spec).getByRole("link", { name: "The Tag-Chain specification" })).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/blob/main/TAG-CHAIN-SPEC.md",
  );
  expect(within(spec).getByRole("link", { name: "How Konspecter reads tags" })).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/blob/main/docs/architecture/tags.md",
  );
  expect(
    within(spec).getByRole("link", { name: "How folders follow tags on a computer" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/blob/main/docs/architecture/decisions/ADR-013-folders-follow-tags.md",
  );
});

it("speaks Russian, with Russian tags in the tree's order", async () => {
  renderTagChain("ru");
  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Tag-Chain: теги, из которых растёт дерево",
    }),
  ).toBeInTheDocument();
  const shared = screen.getByRole("region", { name: "Один тег — в разных местах" });
  expect(folders(within(shared).getByRole("list", { name: "Дерево" }))).toEqual([
    "Путешествия",
    "Италия",
    "Рецепты",
    "Италия",
  ]);
  expect(screen.getByText("~/Konspecter/путешествия/италия/рим.md")).toBeInTheDocument();
});
