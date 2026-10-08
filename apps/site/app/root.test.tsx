import { render, screen } from "@testing-library/react";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { accountContext } from "./account.server";
import App, { loader, SearchTags } from "./root";

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

describe("search engines", () => {
  const load = (path: string, cookie = "", language = "") => {
    const context = new RouterContextProvider();
    context.set(accountContext, { user: null, enabled: true });
    const request = new Request(`http://site.test${path}`, {
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(language ? { "Accept-Language": language } : {}),
      },
    });
    return loader({ request, params: {}, context } as never);
  };
  /** Where the loader redirects to, or null when it renders the page. */
  const redirected = (path: string, cookie = "", language = "") => {
    try {
      load(path, cookie, language);
      return null;
    } catch (error) {
      if (!(error instanceof Response)) throw error;
      expect(error.status).toBe(302);
      expect(error.headers.get("Vary")).toBe("Cookie, Accept-Language");
      return error.headers.get("Location");
    }
  };

  it("gives a public page its own address and its translations", () => {
    expect(load("/ru/markdown").search).toEqual({
      canonical: "http://site.test/ru/markdown",
      alternates: [
        { hreflang: "en", href: "http://site.test/markdown" },
        { hreflang: "ru", href: "http://site.test/ru/markdown" },
        { hreflang: "x-default", href: "http://site.test/markdown" },
      ],
    });
    expect(load("/ru/markdown").locale).toBe("ru");
  });

  it("keeps other pages out of search", () => {
    expect(load("/login").search).toBeNull();
  });

  it("sends a public page to the language the visitor chose", () => {
    expect(redirected("/terms?x=1", "lang=ru")).toBe("/ru/terms?x=1");
    expect(redirected("/ru/terms", "lang=en", "ru")).toBe("/terms");
    expect(redirected("/ru/terms", "lang=ru")).toBeNull();
  });

  it("opens the browser's language from the default address", () => {
    expect(redirected("/", "", "ru-RU,ru;q=0.9,en;q=0.8")).toBe("/ru/");
    expect(redirected("/markdown", "", "de-DE,ru;q=0.5")).toBe("/ru/markdown");
    // Nothing to go by, or a language the site lacks: the x-default stays.
    expect(redirected("/markdown")).toBeNull();
    expect(redirected("/markdown", "", "de-DE")).toBeNull();
    // A choice wins over the browser.
    expect(redirected("/markdown", "lang=en", "ru")).toBeNull();
  });

  it("never moves a language's own address by the browser's language", () => {
    expect(redirected("/ru/markdown", "", "en-US")).toBeNull();
    expect(redirected("/login", "", "ru")).toBeNull();
  });

  it("renders the canonical and hreflang links, or noindex", () => {
    const { unmount } = render(
      <SearchTags
        search={{
          canonical: "https://konspecter.com/",
          alternates: [{ hreflang: "ru", href: "https://konspecter.com/ru/" }],
        }}
      />,
    );
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://konspecter.com/",
    );
    expect(document.querySelector('link[hreflang="ru"]')).toHaveAttribute(
      "href",
      "https://konspecter.com/ru/",
    );
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    unmount();
    render(<SearchTags search={null} />);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
