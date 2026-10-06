import { translator } from "./i18n/i18n";
import {
  day,
  durationText,
  FREE,
  money,
  parseBilling,
  parsePlans,
  periodText,
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
    expect(billing?.payments).toHaveLength(1);
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

  it("writes days", () => {
    expect(day("2026-11-06T23:30:00Z", "en")).toBe("November 6, 2026");
    expect(day("2026-11-06T12:00:00Z", "ru")).toBe("6 ноября 2026 г.");
  });
});
