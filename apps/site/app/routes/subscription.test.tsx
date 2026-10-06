import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { accountContext } from "../account.server";
import App from "../root";
import type { Billing, GatewayPlan } from "../subscription";
import { action as preferencesAction } from "./preferences";
import Privacy from "./privacy";
import Settings, { action as settingsAction, loader as settingsLoader } from "./settings";
import SubscriptionReturn, { loader as returnLoader } from "./subscription-return";
import Terms from "./terms";

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

function post(path: string, fields: Record<string, string>, cookie = "ksp_session=kss_1") {
  return new Request(`http://site.test${path}`, {
    method: "POST",
    headers: { Origin: "http://site.test", Cookie: cookie },
    body: new URLSearchParams(fields),
  });
}

const plans = {
  paid: true,
  trial: "14d",
  grace: "3d",
  gateways: [
    {
      id: "acme",
      name: "Acme Pay",
      currency: "USD",
      prices: [
        { period: "1m", amount: 3 },
        { period: "1y", amount: 30 },
      ],
    },
  ],
};

const subscription = {
  id: "s1",
  gateway: "acme",
  gateway_name: "Acme Pay",
  period: "1m",
  amount: 3,
  currency: "USD",
  status: "active",
  next_charge_at: null,
  resumable: false,
};

function billingAnswer(changes: Record<string, unknown> = {}) {
  return {
    paid: true,
    access: { state: "active", until: "2026-11-06T12:00:00Z" },
    trial: "14d",
    grace: "3d",
    paid_until: "2026-11-06T12:00:00Z",
    subscription,
    payments: [
      { amount: "3.00", currency: "USD", status: "succeeded", at: "2026-10-06T12:00:00Z" },
    ],
    ...changes,
  };
}

describe("the subscription in the settings", () => {
  it("loads the subscription and the prices of the page's language", async () => {
    const calls = stubApi({
      "GET /api/account": () =>
        Response.json({ email: "ann@example.com", name: "", recent_sign_in: true }),
      "GET /api/devices": () => Response.json({ devices: [] }),
      "GET /api/subscription?locale=ru": () => Response.json(billingAnswer()),
      "GET /api/billing/plans?locale=ru": () => Response.json(plans),
    });
    const request = new Request("http://site.test/settings", { headers: { Cookie: "lang=ru" } });
    const loaded = await settingsLoader(args(request));
    expect(loaded.billing?.access.state).toBe("active");
    expect(loaded.gateways.map((g) => g.name)).toEqual(["Acme Pay"]);
    expect(loaded.billing?.subscription?.gatewayName).toBe("Acme Pay");
    expect(calls.map((c) => c.call)).toContain("GET /api/billing/plans?locale=ru");
  });

  it("leaves it out where sync is free", async () => {
    stubApi({
      "GET /api/account": () =>
        Response.json({ email: "ann@example.com", name: "", recent_sign_in: true }),
      "GET /api/devices": () => Response.json({ devices: [] }),
      "GET /api/subscription?locale=en": () =>
        Response.json({ paid: false, access: { state: "free", until: null } }),
      "GET /api/billing/plans?locale=en": () => Response.json({ paid: false, gateways: [] }),
    });
    const loaded = await settingsLoader(args(new Request("http://site.test/settings")));
    expect(loaded.billing).toBeNull();
  });

  it("starts a subscription with the owner's consent and returns where to pay", async () => {
    const calls = stubApi({
      "POST /api/subscription": () =>
        Response.json(
          { id: "s1", redirect_url: "https://pay.example.com/approve?ba=1" },
          { status: 201 },
        ),
    });
    const result = await settingsAction(
      args(
        post(
          "/settings",
          { intent: "subscribe", plan: "acme:1y", accept: "yes" },
          "lang=ru; ksp_session=kss_1",
        ),
      ),
    );
    expect(result).toEqual({
      intent: "subscribe",
      error: null,
      redirectUrl: "https://pay.example.com/approve?ba=1",
    });
    expect(calls[0]?.body).toEqual({ gateway: "acme", period: "1y", locale: "ru", accept: true });
  });

  it("passes the API's refusal on, and never sends the visitor anywhere but https", async () => {
    stubApi({
      "POST /api/subscription": () =>
        Response.json({ error: { code: "consent_required", message: "" } }, { status: 400 }),
    });
    const refused = await settingsAction(
      args(post("/settings", { intent: "subscribe", plan: "acme:1m" })),
    );
    expect(refused).toMatchObject({
      data: { intent: "subscribe", error: { code: "consent_required" } },
    });

    stubApi({
      "POST /api/subscription": () =>
        Response.json({ redirect_url: "javascript:alert(1)" }, { status: 201 }),
    });
    const odd = await settingsAction(
      args(post("/settings", { intent: "subscribe", plan: "acme:1m", accept: "yes" })),
    );
    expect(odd).toMatchObject({ data: { intent: "subscribe", error: { code: "internal" } } });
  });

  it("cancels and resumes through the API", async () => {
    const calls = stubApi({
      "POST /api/subscription/cancel": () => Response.json(billingAnswer()),
      "POST /api/subscription/resume": () => Response.json(billingAnswer()),
    });
    expect(await settingsAction(args(post("/settings", { intent: "cancel" })))).toEqual({
      intent: "cancel",
      error: null,
    });
    expect(await settingsAction(args(post("/settings", { intent: "resume" })))).toEqual({
      intent: "resume",
      error: null,
    });
    expect(calls.map((c) => c.call)).toEqual([
      "POST /api/subscription/cancel",
      "POST /api/subscription/resume",
    ]);
  });

  function renderSubscription(
    billing: Billing,
    gateways: readonly GatewayPlan[],
    action: () => unknown,
  ) {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        Component: App as never,
        loader: () => ({ locale: "en", theme: "system", email: "ann@example.com", accounts: true }),
        children: [
          {
            path: "settings",
            Component: Settings as never,
            loader: () => ({
              account: { email: "ann@example.com", name: "", recentSignIn: true },
              devices: [],
              devicesFailed: false,
              billing,
              gateways,
              now: Date.parse("2026-10-06T12:00:00Z"),
            }),
            action,
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/settings"]} />);
  }

  const gateways = plans.gateways;
  const base: Billing = {
    paid: true,
    access: { state: "trialing", until: "2026-10-20T12:00:00Z" },
    trial: "14d",
    grace: "3d",
    paidUntil: null,
    subscription: null,
    checkout: null,
    payments: [],
  };

  it("offers the prices, asks to accept the terms and renewal, then goes to pay", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", {
      href: window.location.href,
      origin: window.location.origin,
      assign,
    });
    renderSubscription(base, gateways, () => ({
      intent: "subscribe",
      error: null,
      redirectUrl: "https://pay.example.com/approve?ba=1",
    }));
    const section = await screen.findByRole("region", { name: "Subscription" });
    expect(section).toHaveTextContent("Sync is free during the trial, until October 20, 2026.");
    const options = within(section).getAllByRole("radio");
    expect(options.map((option) => option.closest("label")?.textContent)).toEqual([
      "$3 every month",
      "$30 every year",
    ]);
    const consent = within(section).getByRole("checkbox", {
      name: /renews automatically every period/,
    });
    expect(consent).toBeRequired();
    expect(within(section).getByRole("link", { name: "terms" })).toHaveAttribute("href", "/terms");

    const user = userEvent.setup();
    await user.click(consent);
    await user.click(within(section).getByRole("button", { name: "Subscribe" }));
    expect(await screen.findByRole("link", { name: "Continue to payment" })).toHaveAttribute(
      "href",
      "https://pay.example.com/approve?ba=1",
    );
    expect(assign).toHaveBeenCalledWith("https://pay.example.com/approve?ba=1");
  });

  it("shows a renewing subscription with its payments, and cancels after saying what stays", async () => {
    renderSubscription(
      {
        ...base,
        access: { state: "active", until: "2026-11-06T12:00:00Z" },
        paidUntil: "2026-11-06T12:00:00Z",
        subscription: {
          id: "s1",
          gateway: "acme",
          gatewayName: "Acme Pay",
          period: "1m",
          amount: 3,
          currency: "USD",
          status: "active",
          nextChargeAt: null,
          resumable: false,
        },
        payments: [
          { amount: "3.00", currency: "USD", status: "succeeded", at: "2026-10-06T12:00:00Z" },
        ],
      },
      gateways,
      () => ({ intent: "cancel", error: null }),
    );
    const section = await screen.findByRole("region", { name: "Subscription" });
    expect(section).toHaveTextContent(
      "Subscribed: $3 every month, through Acme Pay. The next payment is on November 6, 2026.",
    );
    expect(within(section).queryByRole("button", { name: "Subscribe" })).toBeNull();
    expect(within(section).getByRole("listitem")).toHaveTextContent("Paid");

    const user = userEvent.setup();
    await user.click(within(section).getByText("Cancel subscription"));
    expect(section).toHaveTextContent("your conspects stay on your devices and on the server");
    await user.click(within(section).getByRole("button", { name: "Yes, cancel" }));
    expect(await within(section).findByRole("status")).toHaveTextContent(
      "The subscription is cancelled.",
    );
  });

  it("tells a paused account from one that never subscribed", async () => {
    const noAction = () => null;
    renderSubscription(
      { ...base, access: { state: "expired", until: "2026-10-01T12:00:00Z" } },
      gateways,
      noAction,
    );
    const section = await screen.findByRole("region", { name: "Subscription" });
    expect(section).toHaveTextContent("Sync is paused.");
    cleanup();
    renderSubscription({ ...base, access: { state: "expired", until: null } }, gateways, noAction);
    expect(await screen.findByRole("region", { name: "Subscription" })).toHaveTextContent(
      "The first 14 days are free",
    );
  });

  it("offers to resume a canceled subscription the server charges", async () => {
    renderSubscription(
      {
        ...base,
        access: { state: "canceled", until: "2026-11-06T12:00:00Z" },
        paidUntil: "2026-11-06T12:00:00Z",
        subscription: {
          id: "s1",
          gateway: "acme",
          gatewayName: "Acme Pay",
          period: "1m",
          amount: 299,
          currency: "RUB",
          status: "canceled",
          nextChargeAt: null,
          resumable: true,
        },
      },
      gateways,
      () => ({ intent: "resume", error: null }),
    );
    const section = await screen.findByRole("region", { name: "Subscription" });
    expect(section).toHaveTextContent(
      "The subscription is cancelled and will not renew. Sync works until November 6, 2026.",
    );
    await userEvent
      .setup()
      .click(within(section).getByRole("button", { name: "Resume subscription" }));
    expect(await within(section).findByRole("status")).toHaveTextContent(
      "The subscription renews again.",
    );
  });
});

describe("the return from the payment service", () => {
  function checkoutAnswer(status: string) {
    return () => Response.json(billingAnswer({ checkout: { ...subscription, status } }));
  }

  it("says how the payment went", async () => {
    for (const [status, outcome] of [
      ["active", "paid"],
      ["pending", "waiting"],
      ["ended", "failed"],
    ] as const) {
      stubApi({ "GET /api/subscription/checkouts/s1": checkoutAnswer(status) });
      const loaded = await returnLoader(
        args(new Request("http://site.test/subscription/return?id=s1")),
      );
      expect(loaded.outcome).toBe(outcome);
    }
    stubApi({
      "GET /api/subscription/checkouts/nope": () =>
        Response.json({ error: { code: "not_found", message: "" } }, { status: 404 }),
    });
    const unknown = await returnLoader(
      args(new Request("http://site.test/subscription/return?id=nope")),
    );
    expect(unknown.outcome).toBe("unknown");
  });

  it("thanks for a payment that went through", async () => {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        Component: App as never,
        loader: () => ({ locale: "en", theme: "system", email: "ann@example.com", accounts: true }),
        children: [
          {
            path: "subscription/return",
            Component: SubscriptionReturn as never,
            loader: () => ({ outcome: "paid", paidUntil: "2026-11-06T12:00:00Z" }),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/subscription/return?id=s1"]} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "The subscription is paid. Sync works until November 6, 2026",
    );
  });
});

describe("the terms and the privacy policy", () => {
  const operator = {
    name: "Ivan Petrov",
    id: "7701234567",
    address: "Moscow",
    email: "help@example.com",
  };

  function renderLegal(Component: () => React.ReactNode, locale: "en" | "ru", paid: boolean) {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        Component: App as never,
        loader: () => ({ locale, theme: "system", email: null, accounts: true }),
        children: [
          {
            path: "page",
            Component: Component as never,
            loader: () => ({
              operator,
              host: "notes.example.com",
              plans: paid ? plans : { paid: false, trial: "", grace: "", gateways: [] },
            }),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/page"]} />);
  }

  it("states the prices, the renewal and how to cancel where sync is paid", async () => {
    renderLegal(Terms, "en", true);
    const page = await screen.findByRole("article");
    expect(page).toHaveTextContent("$3 every month");
    expect(page).toHaveTextContent("one free trial of 14 days");
    expect(page).toHaveTextContent("renews automatically");
    expect(page).toHaveTextContent("cancel at any time");
    expect(page).toHaveTextContent("for 3 days after the paid time ends");
    expect(page).toHaveTextContent("Registration number: 7701234567");
    for (const link of within(page).getAllByRole("link", { name: "help@example.com" })) {
      expect(link).toHaveAttribute("href", "mailto:help@example.com");
    }
  });

  it("is a public offer in Russian", async () => {
    renderLegal(Terms, "ru", true);
    const page = await screen.findByRole("article");
    expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent("Публичная оферта");
    expect(page).toHaveTextContent("ст. 437 ГК РФ");
    expect(page).toHaveTextContent("автоплатёж");
    expect(page).toHaveTextContent("14 дней");
  });

  it("says sync is free where it is", async () => {
    renderLegal(Terms, "en", false);
    const page = await screen.findByRole("article");
    expect(page).toHaveTextContent("Sync on this server is free.");
    expect(page).not.toHaveTextContent("renews automatically");
  });

  it("lists every cookie the site sets", async () => {
    renderLegal(Privacy, "en", true);
    const table = await screen.findByRole("table");
    for (const name of ["ksp_session", "lang", "theme", "cookies"]) {
      expect(within(table).getByText(name)).toBeInTheDocument();
    }
  });
});

describe("the cookie notice", () => {
  function renderRoot(cookieNotice: boolean) {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        Component: App as never,
        loader: () => ({
          locale: "en",
          theme: "system",
          email: null,
          name: "",
          accounts: true,
          cookieNotice,
        }),
        children: [{ index: true, Component: () => null }],
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
  }

  it("says which cookies are set until the visitor says OK", async () => {
    renderRoot(true);
    const notice = await screen.findByRole("complementary", { name: "Cookies" });
    expect(within(notice).getByRole("link", { name: "About cookies" })).toHaveAttribute(
      "href",
      "/privacy#cookies",
    );
    const ok = within(notice).getByRole("button", { name: "OK" });
    expect(ok.closest("form")).toHaveAttribute("action", "/preferences");
  });

  it("is gone once seen", async () => {
    renderRoot(false);
    await screen.findByRole("contentinfo");
    expect(screen.queryByRole("complementary", { name: "Cookies" })).toBeNull();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  it("remembers the OK, and a signed-in visitor's language goes to the account", async () => {
    const calls = stubApi({ "PATCH /api/account": () => Response.json({}) });
    const response = await preferencesAction(
      args(post("/preferences", { cookies: "ok", lang: "ru", back: "/settings" })),
    );
    expect(response.headers.get("Location")).toBe("/settings");
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("cookies=ok");
    expect(cookies).toContain("lang=ru");
    expect(calls).toEqual([{ call: "PATCH /api/account", body: { locale: "ru" } }]);

    const signedOut = stubApi({});
    await preferencesAction(args(post("/preferences", { lang: "en" }), false));
    expect(signedOut).toEqual([]);
  });
});
