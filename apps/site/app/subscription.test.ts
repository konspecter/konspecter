import { translator } from "./i18n/i18n";
import {
  day,
  discounts,
  durationText,
  encryptedOf,
  FREE,
  money,
  parseBilling,
  parsePlans,
  periodText,
  setupStep,
  syncWorks,
} from "./subscription";

describe("parsePlans", () => {
  it("reads what the server sells", () => {
    expect(
      parsePlans({
        paid: true,
        trial: "14d",
        grace: "3d",
        gateways: [
          {
            id: "acme",
            name: "Acme Pay",
            currency: "RUB",
            prices: [{ period: "1m", amount: 299 }, { bad: 1 }],
          },
          { id: "nameless", currency: "USD", prices: [{ period: "1y", amount: 30 }] },
          { id: "empty", currency: "USD", prices: [] },
        ],
      }),
    ).toEqual({
      paid: true,
      trial: "14d",
      grace: "3d",
      gateways: [
        { id: "acme", name: "Acme Pay", currency: "RUB", prices: [{ period: "1m", amount: 299 }] },
        // A gateway the service gave no name goes by its id.
        {
          id: "nameless",
          name: "nameless",
          currency: "USD",
          prices: [{ period: "1y", amount: 30 }],
        },
      ],
    });
  });

  it("reads anything else as free", () => {
    expect(parsePlans({ paid: false })).toBe(FREE);
    expect(parsePlans(null)).toBe(FREE);
  });
});

describe("parseBilling", () => {
  it("reads the account's subscription and payments", () => {
    const billing = parseBilling({
      paid: true,
      access: { state: "active", until: "2026-11-06T12:00:00Z" },
      trial: "",
      grace: "3d",
      paid_until: "2026-11-06T12:00:00Z",
      subscription: {
        id: "s1",
        gateway: "acme",
        gateway_name: "Acme Pay",
        period: "1m",
        amount: 3,
        currency: "USD",
        status: "active",
        next_charge_at: null,
        resumable: false,
      },
      checkout: null,
      payments: [
        { amount: "3.00", currency: "USD", status: "succeeded", at: "2026-10-06T12:00:00Z" },
        { amount: "3.00", currency: "USD", status: "pending", at: "2026-10-06T12:00:00Z" },
        {
          amount: "3.00",
          currency: "USD",
          status: "partially_refunded",
          at: "2026-09-06T12:00:00Z",
        },
      ],
    });
    expect(billing?.access).toEqual({ state: "active", until: "2026-11-06T12:00:00Z" });
    expect(billing?.subscription).toMatchObject({
      id: "s1",
      gatewayName: "Acme Pay",
      status: "active",
      amount: 3,
    });
    expect(billing?.checkout).toBeNull();
    expect(billing?.autoRenewChoice).toBe(true);
    const once = parseBilling({ access: { state: "canceled" }, auto_renew_choice: false });
    expect(once?.autoRenewChoice).toBe(false);
    expect(billing?.payments.map((payment) => payment.status)).toEqual([
      "succeeded",
      "partially_refunded",
    ]);
  });

  it("refuses what is not an answer about sync", () => {
    expect(parseBilling({ access: { state: "rich" } })).toBeNull();
    expect(parseBilling("nope")).toBeNull();
  });
});

describe("formatting", () => {
  const en = translator("en");
  const ru = translator("ru");

  it("writes money as each language does", () => {
    expect(money(3, "USD", "en")).toBe("$3");
    expect(money("299.00", "RUB", "ru")).toMatch(/^299\s₽$/);
    expect(money("3.50", "EUR", "en")).toBe("€3.50");
    expect(money(5, "nope", "en")).toBe("5 nope");
  });

  it("writes periods and durations", () => {
    expect(periodText(en, "1m")).toBe("month");
    expect(periodText(en, "3m")).toBe("3 months");
    expect(periodText(ru, "1m")).toBe("месяц");
    expect(periodText(ru, "2w")).toBe("2 недели");
    expect(durationText(en, "1m")).toBe("1 month");
    expect(durationText(ru, "14d")).toBe("14 дней");
    expect(durationText(ru, "3d")).toBe("3 дня");
    expect(periodText(en, "x")).toBe("x");
  });

  it("works out what a longer period saves", () => {
    expect(
      discounts([
        { period: "1m", amount: 3 },
        { period: "3m", amount: 8 },
        { period: "1y", amount: 30 },
      ]),
    ).toEqual([0, 11, 17]);
    // Against the dearest month, whichever comes first; never below nothing.
    expect(
      discounts([
        { period: "12m", amount: 2990 },
        { period: "1m", amount: 299 },
        { period: "1q", amount: 897 },
      ]),
    ).toEqual([17, 0, 0]);
    expect(discounts([{ period: "1m", amount: 3 }])).toEqual([0]);
    expect(
      discounts([
        { period: "x", amount: 3 },
        { period: "1m", amount: 0 },
      ]),
    ).toEqual([0, 0]);
  });

  it("writes days", () => {
    expect(day("2026-11-06T23:30:00Z", "en")).toBe("November 6, 2026");
    expect(day("2026-11-06T12:00:00Z", "ru")).toBe("6 ноября 2026 г.");
  });
});

describe("setting sync up", () => {
  it("reads whether the account has an encryption key", () => {
    expect(encryptedOf({ status: 200, error: null })).toBe(true);
    expect(encryptedOf({ status: 404, error: { code: "no_key" } })).toBe(false);
    expect(encryptedOf({ status: 503, error: { code: "unreachable" } })).toBeNull();
  });

  it("names the step left: encryption, then an app", () => {
    expect(setupStep(false, 0)).toBe("encryption");
    expect(setupStep(false, 2)).toBe("encryption");
    expect(setupStep(true, 0)).toBe("connect");
    expect(setupStep(true, 1)).toBeNull();
    // Not known: nothing to nag about.
    expect(setupStep(null, 0)).toBeNull();
    expect(setupStep(true, null)).toBeNull();
  });
});

describe("whether the account syncs", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const access = (state: string, until: string | null = null) => ({ access: { state, until } });

  it("syncs where sync is free, and while paid time is left", () => {
    expect(syncWorks(access("free"), now)).toBe(true);
    expect(syncWorks(access("trialing", "2026-10-15T00:00:00Z"), now)).toBe(true);
    expect(syncWorks(access("past_due", "2026-10-06T00:00:00Z"), now)).toBe(true);
  });

  it("does not once the time is over, expired, or where the server offers none", () => {
    expect(syncWorks(access("canceled", "2026-10-01T00:00:00Z"), now)).toBe(false);
    expect(syncWorks(access("active"), now)).toBe(false);
    expect(syncWorks(access("expired"), now)).toBe(false);
    expect(syncWorks(access("unavailable"), now)).toBe(false);
  });

  it("does not know from an answer that says neither", () => {
    expect(syncWorks(null, now)).toBeNull();
    expect(syncWorks({ error: "billing_unavailable" }, now)).toBeNull();
  });
});
