import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { accountContext } from "../account.server";
import App from "../root";
import type { Platform } from "../platform";
import Home, { action as homeAction, loader as homeLoader } from "./home";

interface Pricing {
  options: {
    plan: string;
    gateway: string;
    amount: number;
    currency: string;
    period: string;
    discount: number;
  }[];
  several: boolean;
  trial: string;
}

/** Sync for $3 a month, $8 a quarter and $30 a year, on one gateway. */
const PRICING: Pricing = {
  options: [
    { plan: "acme:1m", gateway: "Acme", amount: 3, currency: "USD", period: "1m", discount: 0 },
    { plan: "acme:3m", gateway: "Acme", amount: 8, currency: "USD", period: "3m", discount: 11 },
    { plan: "acme:1y", gateway: "Acme", amount: 30, currency: "USD", period: "1y", discount: 17 },
  ],
  several: false,
  trial: "14d",
};

function renderHome(
  locale: "en" | "ru",
  downloads: { platform: Platform; url: string }[],
  suggested: Platform | null = null,
  pricing: Pricing | null = null,
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
          action: () => ({ error: { code: "already_subscribed" } }),
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
  // The hero's button reads one short word, so both of its buttons fit a line.
  expect(screen.getAllByRole("link", { name: "Download for macOS" })[0]).toHaveTextContent(
    /^Download$/,
  );
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

it("offers your own way and the paid sync, every period with what it saves", async () => {
  renderHome("en", [{ platform: "web", url: "https://app.example.com/" }], null, PRICING);
  const sync = await screen.findByRole("region", { name: "Sync between your devices" });
  // Sync comes right after the hero, before the features.
  expect(
    sync.compareDocumentPosition(screen.getByRole("region", { name: "Why Konspecter" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(sync).getByRole("heading", { name: "Your own way" })).toBeInTheDocument();
  expect(sync).toHaveTextContent("Keep that folder in iCloud Drive");
  expect(within(sync).getByRole("link", { name: "Self-hosting guide" })).toHaveAttribute(
    "href",
    "https://github.com/konspecter/konspecter/blob/main/docs/self-hosting.md",
  );
  expect(within(sync).getByRole("heading", { name: "Konspecter sync" })).toBeInTheDocument();
  expect(sync).toHaveTextContent("Cancel any time. The first 14 days are free.");
  const periods = within(sync).getByRole("group", { name: "Choose a period" });
  const month = within(periods).getByRole("radio", { name: "$3 every month" });
  const quarter = within(periods).getByRole("radio", { name: "$8 every 3 months -11%" });
  const year = within(periods).getByRole("radio", { name: "$30 every year -17%" });
  expect(month).toBeChecked();
  const price = sync.querySelector(".price-buy .price-amount");
  expect(price).toHaveTextContent("$3 every month");
  // The price on top follows the chosen period.
  await userEvent.click(year);
  expect(year).toBeChecked();
  expect(quarter).not.toBeChecked();
  expect(price).toHaveTextContent("$30 every year");
  expect(within(sync).getByRole("checkbox", { name: /I accept the terms/ })).toBeRequired();
  expect(within(sync).getByRole("button", { name: "Buy sync" })).toBeInTheDocument();
  expect(within(sync).getByRole("link", { name: "Try sync for free" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(within(sync).getByRole("link", { name: "Prices and terms" })).toHaveAttribute(
    "href",
    "/terms",
  );
});

it("shows why buying failed", async () => {
  renderHome("en", [], null, { ...PRICING, trial: "" });
  const sync = await screen.findByRole("region", { name: "Sync between your devices" });
  expect(within(sync).queryByRole("link", { name: "Try sync for free" })).not.toBeInTheDocument();
  await userEvent.click(within(sync).getByRole("checkbox", { name: /I accept the terms/ }));
  await userEvent.click(within(sync).getByRole("button", { name: "Buy sync" }));
  expect(await within(sync).findByRole("alert")).toHaveTextContent(
    "The account already has a subscription.",
  );
});

it("offers one price without a choice", async () => {
  const [month] = PRICING.options;
  renderHome("en", [], null, { ...PRICING, options: month ? [month] : [] });
  const sync = await screen.findByRole("region", { name: "Sync between your devices" });
  expect(within(sync).queryByRole("group", { name: "Choose a period" })).not.toBeInTheDocument();
  expect(sync).toHaveTextContent("$3 every month");
  expect(sync.querySelector('input[type="hidden"][name="plan"]')).toHaveValue("acme:1m");
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

describe("buying sync", () => {
  /** The API's replies, by method and path; each call is recorded. */
  function stubApi(replies: Record<string, () => Response>) {
    const calls: { call: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        const parsed = new URL(url);
        const call = `${init.method ?? "GET"} ${parsed.pathname}${parsed.search}`;
        const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
        calls.push({ call, body });
        const reply = replies[call];
        return reply ? Promise.resolve(reply()) : Promise.reject(new Error(`unexpected ${call}`));
      }),
    );
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function args(request: Request, signedIn = true) {
    const context = new RouterContextProvider();
    context.set(accountContext, {
      user: signedIn ? { id: "u1", email: "ann@example.com", name: "" } : null,
      enabled: true,
    });
    return { request, params: {}, context } as never;
  }

  const buy = (fields: Record<string, string>) =>
    new Request("http://site.test/", {
      method: "POST",
      headers: { Origin: "http://site.test", Cookie: "ksp_session=kss_1" },
      body: new URLSearchParams(fields),
    });

  it("offers every price on sale, with what each saves", async () => {
    stubApi({
      "GET /api/billing/plans?locale=en": () =>
        Response.json({
          paid: true,
          trial: "14d",
          gateways: [
            {
              id: "acme",
              name: "Acme",
              currency: "USD",
              prices: [
                { period: "1m", amount: 3 },
                { period: "1y", amount: 30 },
              ],
            },
            { id: "bank", name: "Bank", currency: "EUR", prices: [{ period: "1m", amount: 3 }] },
          ],
        }),
    });
    const loaded = await homeLoader(args(new Request("http://site.test/")));
    expect(loaded.sync).toBe("paid");
    expect(loaded.pricing).toEqual({
      options: [
        { plan: "acme:1m", gateway: "Acme", amount: 3, currency: "USD", period: "1m", discount: 0 },
        {
          plan: "acme:1y",
          gateway: "Acme",
          amount: 30,
          currency: "USD",
          period: "1y",
          discount: 17,
        },
        { plan: "bank:1m", gateway: "Bank", amount: 3, currency: "EUR", period: "1m", discount: 0 },
      ],
      several: true,
      trial: "14d",
    });
  });

  it("goes straight to the gateway's page", async () => {
    const calls = stubApi({
      "POST /api/subscription": () =>
        Response.json({ redirect_url: "https://pay.example.com/c/1" }, { status: 201 }),
    });
    const response = (await homeAction(args(buy({ plan: "acme:1y", accept: "yes" })))) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://pay.example.com/c/1");
    expect(calls[0]?.body).toEqual({ gateway: "acme", period: "1y", locale: "en", accept: true });
  });

  it("sends a signed-out visitor to sign in, then to settings with the period chosen", async () => {
    const calls = stubApi({});
    await expect(
      homeAction(args(buy({ plan: "acme:1y", accept: "yes" }), false)),
    ).rejects.toSatisfy(
      (response: Response) =>
        response.headers.get("Location") ===
        `/login?next=${encodeURIComponent("/settings?plan=acme%3A1y#subscription")}`,
    );
    expect(calls).toEqual([]);
  });

  it("says why the API refused", async () => {
    stubApi({
      "POST /api/subscription": () =>
        Response.json({ error: { code: "consent_required", message: "" } }, { status: 400 }),
    });
    expect(await homeAction(args(buy({ plan: "acme:1m" })))).toMatchObject({
      data: { error: { code: "consent_required" } },
      init: { status: 400 },
    });
  });
});
