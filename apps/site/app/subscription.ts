import type { Locale, SiteTranslator } from "./i18n/i18n";

/**
 * Paid sync as the API reports it: what the server sells
 * (`GET /api/billing/plans`) and the account's subscription
 * (`GET /api/subscription`). Parsed from unknown JSON, defensively.
 */

export interface Price {
  /** {N}{d|w|m|q|y}, such as "1m". */
  readonly period: string;
  /** Whole units of the gateway's currency. */
  readonly amount: number;
}

export interface GatewayPlan {
  readonly id: string;
  /** The gateway as payers know it, in the page's language (else its id). */
  readonly name: string;
  readonly currency: string;
  readonly prices: readonly Price[];
}

export interface Plans {
  /** Whether sync costs anything on this server. */
  readonly paid: boolean;
  /** The free trial, such as "14d" ("" for none). */
  readonly trial: string;
  /** Free days after paid time, such as "3d" ("" for none). */
  readonly grace: string;
  readonly gateways: readonly GatewayPlan[];
}

export const FREE: Plans = { paid: false, trial: "", grace: "", gateways: [] };

/** The account's entitlement ("free" where sync costs nothing). */
export type AccessState = "free" | "trialing" | "active" | "past_due" | "canceled" | "expired";

export type SubscriptionStatus = "pending" | "active" | "past_due" | "canceled" | "ended";

export interface Subscription {
  readonly id: string;
  readonly gateway: string;
  /** The gateway as payers know it, in the page's language (else its id). */
  readonly gatewayName: string;
  readonly period: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: SubscriptionStatus;
  readonly nextChargeAt: string | null;
  /** A canceled subscription that can renew again as it is. */
  readonly resumable: boolean;
}

export interface Payment {
  readonly amount: string;
  readonly currency: string;
  readonly status: "succeeded" | "failed" | "refunded";
  readonly at: string;
}

export interface Billing {
  readonly paid: boolean;
  readonly access: { readonly state: AccessState; readonly until: string | null };
  readonly trial: string;
  readonly grace: string;
  readonly paidUntil: string | null;
  /** The account's subscription that has not ended. */
  readonly subscription: Subscription | null;
  /** The subscription a return page asked about. */
  readonly checkout: Subscription | null;
  readonly payments: readonly Payment[];
}

const ACCESS: readonly AccessState[] = [
  "free",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
];
const STATUSES: readonly SubscriptionStatus[] = [
  "pending",
  "active",
  "past_due",
  "canceled",
  "ended",
];
const PAYMENT_STATUSES: readonly Payment["status"][] = ["succeeded", "failed", "refunded"];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const time = (value: unknown): string | null => (typeof value === "string" ? value : null);
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

export function parsePlans(value: unknown): Plans {
  const body = record(value);
  if (body.paid !== true) return FREE;
  const gateways = (Array.isArray(body.gateways) ? body.gateways : []).flatMap((item) => {
    const gateway = record(item);
    const prices = (Array.isArray(gateway.prices) ? gateway.prices : []).flatMap((p) => {
      const price = record(p);
      return typeof price.period === "string" && typeof price.amount === "number"
        ? [{ period: price.period, amount: price.amount }]
        : [];
    });
    return typeof gateway.id === "string" && prices.length > 0
      ? [
          {
            id: gateway.id,
            name: text(gateway.name) || gateway.id,
            currency: text(gateway.currency),
            prices,
          },
        ]
      : [];
  });
  return { paid: true, trial: text(body.trial), grace: text(body.grace), gateways };
}

function parseSubscriptionItem(value: unknown): Subscription | null {
  const item = record(value);
  const status = oneOf(STATUSES, item.status);
  if (typeof item.id !== "string" || !status) return null;
  return {
    id: item.id,
    gateway: text(item.gateway),
    gatewayName: text(item.gateway_name) || text(item.gateway),
    period: text(item.period),
    amount: typeof item.amount === "number" ? item.amount : 0,
    currency: text(item.currency),
    status,
    nextChargeAt: time(item.next_charge_at),
    resumable: item.resumable === true,
  };
}

export function parseBilling(value: unknown): Billing | null {
  const body = record(value);
  const access = record(body.access);
  const state = oneOf(ACCESS, access.state);
  if (!state) return null;
  const payments = (Array.isArray(body.payments) ? body.payments : []).flatMap((item) => {
    const payment = record(item);
    const status = oneOf(PAYMENT_STATUSES, payment.status);
    return status && typeof payment.at === "string"
      ? [{ amount: text(payment.amount), currency: text(payment.currency), status, at: payment.at }]
      : [];
  });
  return {
    paid: body.paid === true,
    access: { state, until: time(access.until) },
    trial: text(body.trial),
    grace: text(body.grace),
    paidUntil: time(body.paid_until),
    subscription: parseSubscriptionItem(body.subscription),
    checkout: parseSubscriptionItem(body.checkout),
    payments,
  };
}

/** An amount in a currency, as the page's language writes it: "$3", "299 ₽". */
export function money(amount: number | string, currency: string, locale: Locale): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(currency))
    return `${String(amount)} ${currency}`;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const UNITS = { d: "day", w: "week", m: "month", q: "quarter", y: "year" } as const;

/** A period ("3m") split into its count and unit; null when it is not one. */
export function parsePeriod(
  period: string,
): { count: number; unit: (typeof UNITS)[keyof typeof UNITS] } | null {
  const match = /^(\d+)([dwmqy])$/.exec(period);
  if (!match) return null;
  return { count: Number(match[1]), unit: UNITS[match[2] as keyof typeof UNITS] };
}

/** How long a period is, in words: "month", "3 months", "14 days". */
export function periodText(t: SiteTranslator, period: string): string {
  const parsed = parsePeriod(period);
  if (!parsed) return period;
  if (parsed.count === 1) return t.t(`subscription.unit.${parsed.unit}`);
  return t.tn(`subscription.units.${parsed.unit}`, parsed.count);
}

/** How much time a period is, always with its count: "1 month", "14 days". */
export function durationText(t: SiteTranslator, period: string): string {
  const parsed = parsePeriod(period);
  if (!parsed) return period;
  return t.tn(`subscription.units.${parsed.unit}`, parsed.count);
}

/** A day as the page's language writes it (UTC, as the server counts). */
export function day(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}
