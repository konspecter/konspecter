import { richText } from "@konspecter/i18n/rich";
import { data, Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { requireUser, signInPath } from "../account.server";
import { callApi, withCookies, type ApiResult } from "../api.server";
import { Field, FormMessage, formError, Submit, textField, type FormError } from "../auth-form";
import { ConnectApp, parseConnectCode, type ConnectCode } from "../connect-app";
import { parseDevices, timeAgo, type Device } from "../devices";
import { Encryption } from "../encryption";
import { useLocale, useT } from "../i18n/i18n";
import { readPreferences } from "../preferences.server";
import { parseBilling, parsePlans } from "../subscription";
import { SubscriptionSection } from "../subscription-section";
import type { Route } from "./+types/settings";

/**
 * The account's settings: its name, the subscription (where sync is paid),
 * connecting an app by QR code, the connected devices (each can be
 * disconnected: it stops syncing and keeps its conspects), encryption, and
 * deleting the account. Plain forms, so the page works without JavaScript,
 * except the encryption, which runs in the browser (encryption.tsx).
 */

interface AccountData {
  readonly email: string;
  readonly name: string;
  readonly recentSignIn: boolean;
}

function parseAccount(value: unknown): AccountData | null {
  if (typeof value !== "object" || value === null) return null;
  const { email, name, recent_sign_in: recent } = value as Record<string, unknown>;
  if (typeof email !== "string") return null;
  return { email, name: typeof name === "string" ? name : "", recentSignIn: recent === true };
}

/** A signed-out visitor (or an expired session) goes to sign in and comes back. */
function signInAgainOn401(request: Request, result: ApiResult<unknown>): void {
  if (result.status === 401) throw redirect(signInPath(request));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  requireUser(request, context);
  const { locale } = readPreferences(request);
  const [account, devices, billing, plans] = await Promise.all([
    callApi(request, "/api/account"),
    callApi(request, "/api/devices"),
    callApi(request, `/api/subscription?locale=${locale}`),
    callApi(request, `/api/billing/plans?locale=${locale}`),
  ]);
  signInAgainOn401(request, account);
  const parsed = parseAccount(account.data);
  if (!parsed) throw data("The account could not be loaded", { status: 503 });
  const subscription = parseBilling(billing.data);
  return {
    account: parsed,
    devices: parseDevices(devices.data),
    devicesFailed: devices.error !== null,
    // Shown only where sync is paid.
    billing: subscription?.paid ? subscription : null,
    gateways: parsePlans(plans.data).gateways,
    now: Date.now(),
  };
}

type Intent = "rename" | "connect" | "disconnect" | "delete" | "subscribe" | "cancel" | "resume";

interface ActionResult {
  readonly intent: Intent;
  readonly error: FormError | null;
  /** The disconnected device's name, for the notice. */
  readonly disconnected?: string;
  /** The code to connect an app with. */
  readonly connect?: ConnectCode;
  /** Where to pay for the subscription just started. */
  readonly redirectUrl?: string;
}

function failed(intent: Intent, result: ApiResult<unknown>) {
  const error = result.error ?? { code: "internal" };
  return data<ActionResult>(
    { intent, error: formError(error.code, result.retryAfter) },
    result.status,
  );
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = textField(form, "intent");

  if (intent === "rename") {
    const result = await callApi(request, "/api/account", {
      method: "PATCH",
      body: { name: textField(form, "name") },
    });
    signInAgainOn401(request, result);
    if (result.error) return failed("rename", result);
    return { intent: "rename", error: null } satisfies ActionResult;
  }

  if (intent === "connect") {
    const result = await callApi(request, "/api/devices/connect-codes", { method: "POST" });
    signInAgainOn401(request, result);
    const code = parseConnectCode(result.data);
    if (result.error || !code) return failed("connect", result);
    return { intent: "connect", error: null, connect: code } satisfies ActionResult;
  }

  if (intent === "disconnect") {
    const id = textField(form, "id");
    const result = await callApi(request, `/api/devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    signInAgainOn401(request, result);
    // Already gone (another tab) is as good as done.
    if (result.error && result.status !== 404) return failed("disconnect", result);
    return {
      intent: "disconnect",
      error: null,
      disconnected: textField(form, "name"),
    } satisfies ActionResult;
  }

  if (intent === "subscribe") {
    const [gateway = "", period = ""] = textField(form, "plan").split(":");
    const result = await callApi<{ redirect_url?: unknown }>(request, "/api/subscription", {
      method: "POST",
      body: {
        gateway,
        period,
        locale: readPreferences(request).locale,
        accept: textField(form, "accept") === "yes",
      },
    });
    signInAgainOn401(request, result);
    const redirectUrl = result.data?.redirect_url;
    if (result.error || typeof redirectUrl !== "string" || !/^https:\/\//.test(redirectUrl)) {
      return failed("subscribe", result);
    }
    return { intent: "subscribe", error: null, redirectUrl } satisfies ActionResult;
  }

  if (intent === "cancel" || intent === "resume") {
    const result = await callApi(request, `/api/subscription/${intent}`, { method: "POST" });
    signInAgainOn401(request, result);
    if (result.error) return failed(intent, result);
    return { intent, error: null } satisfies ActionResult;
  }

  if (intent === "delete") {
    const result = await callApi(request, "/api/account", {
      method: "DELETE",
      body: { email: textField(form, "email").trim() },
    });
    signInAgainOn401(request, result);
    if (result.error) return failed("delete", result);
    return redirect("/", { headers: withCookies(result.cookies) });
  }

  return data<ActionResult>({ intent: "rename", error: { code: "invalid_request" } }, 400);
}

export default function Settings() {
  const { t } = useT();
  const { account, devices, devicesFailed, billing, gateways, now } =
    useLoaderData<typeof loader>();
  const result = useActionData<ActionResult>();
  const errorOf = (intent: Intent) => (result?.intent === intent ? result.error : null);
  const billingIntent =
    result?.intent === "subscribe" || result?.intent === "cancel" || result?.intent === "resume";

  return (
    <section className="settings-page site-frame" aria-labelledby="settings-title">
      <title>{`${t("settings.title")} · Konspecter`}</title>
      <h1 id="settings-title">{t("settings.title")}</h1>
      <p className="settings-lead">
        {richText(t(account.name ? "settings.leadNamed" : "settings.lead"), {
          name: account.name,
          email: <strong className="auth-email">{account.email}</strong>,
        })}
      </p>

      <section className="settings-section" aria-labelledby="name-heading">
        <h2 id="name-heading">{t("settings.name.title")}</h2>
        <Form method="post" className="settings-form">
          <Field
            label={t("settings.name.label")}
            hint={t("settings.name.hint")}
            name="name"
            autoComplete="name"
            maxLength={100}
            defaultValue={account.name}
          />
          <FormMessage
            error={errorOf("rename")}
            notice={result?.intent === "rename" && !result.error ? t("settings.name.saved") : null}
          />
          <div className="actions">
            <Submit intent="rename" primary={false}>
              {t("settings.name.save")}
            </Submit>
          </div>
        </Form>
      </section>

      {billing && (
        <SubscriptionSection
          billing={billing}
          gateways={gateways}
          error={billingIntent ? result.error : null}
          notice={
            result?.error
              ? null
              : result?.intent === "cancel"
                ? t("subscription.done.cancel")
                : result?.intent === "resume"
                  ? t("subscription.done.resume")
                  : null
          }
          redirectUrl={result?.redirectUrl ?? null}
        />
      )}

      <section className="settings-section" id="connect" aria-labelledby="connect-heading">
        <h2 id="connect-heading">{t("settings.connect.title")}</h2>
        <p className="settings-text">{t("settings.connect.lead")}</p>
        <ConnectApp code={result?.connect ?? null} error={errorOf("connect")} devices={devices} />
      </section>

      <section className="settings-section" aria-labelledby="devices-heading">
        <h2 id="devices-heading">{t("settings.devices.title")}</h2>
        <p className="settings-text">{t("settings.devices.lead")}</p>
        <FormMessage
          error={errorOf("disconnect")}
          notice={
            result?.disconnected !== undefined
              ? t("settings.devices.disconnected", { name: result.disconnected })
              : null
          }
        />
        {devicesFailed ? (
          <p className="inline-error">{t("settings.devices.failed")}</p>
        ) : devices.length === 0 ? (
          <p className="settings-empty">{t("settings.devices.empty")}</p>
        ) : (
          <ul className="device-list" aria-labelledby="devices-heading">
            {devices.map((device) => (
              <DeviceRow key={device.id} device={device} now={now} />
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section" id="encryption" aria-labelledby="encryption-heading">
        <h2 id="encryption-heading">{t("encryption.title")}</h2>
        <p className="settings-text">{t("encryption.lead")}</p>
        <Encryption />
      </section>

      <section className="settings-section" id="delete" aria-labelledby="delete-heading">
        <h2 id="delete-heading">{t("settings.delete.title")}</h2>
        <p className="settings-text">{t("settings.delete.lead")}</p>
        {account.recentSignIn ? (
          <Form method="post" className="settings-form">
            <Field
              label={t("settings.delete.label", { email: account.email })}
              name="email"
              type="email"
              autoComplete="off"
              required
            />
            <FormMessage error={errorOf("delete")} />
            <div className="actions">
              <DangerSubmit>{t("settings.delete.submit")}</DangerSubmit>
            </div>
          </Form>
        ) : (
          // Signing in again starts a fresh session, which may delete the account.
          <form method="post" action="/logout" className="settings-form">
            <input type="hidden" name="next" value="/login?next=%2Fsettings%23delete" />
            <p className="settings-text">{t("settings.delete.signInAgain")}</p>
            <div className="actions">
              <button type="submit" className="button">
                {t("settings.delete.signInAgainButton")}
              </button>
            </div>
          </form>
        )}
      </section>
    </section>
  );
}

function DeviceRow({ device, now }: { device: Device; now: number }) {
  const { t } = useT();
  const locale = useLocale();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "disconnect" &&
    navigation.formData.get("id") === device.id;
  const platform = t(`device.platform.${device.platform}`);
  const activity = device.lastSyncAt
    ? t("settings.devices.lastSynced", { when: timeAgo(device.lastSyncAt, now, locale) })
    : device.lastUsedAt
      ? t("settings.devices.lastActive", { when: timeAgo(device.lastUsedAt, now, locale) })
      : t("settings.devices.connected", { when: timeAgo(device.createdAt, now, locale) });
  return (
    <li className="device">
      <div className="device-about">
        <p className="device-name">{device.name}</p>
        <p className="device-meta">
          {device.clientVersion
            ? t("settings.devices.platformVersion", { platform, version: device.clientVersion })
            : platform}
        </p>
        <p className="device-meta">{activity}</p>
      </div>
      <Form method="post">
        <input type="hidden" name="id" value={device.id} />
        <input type="hidden" name="name" value={device.name} />
        <button
          type="submit"
          name="intent"
          value="disconnect"
          className="button"
          disabled={navigation.state === "submitting"}
          aria-label={t("settings.devices.disconnectNamed", { name: device.name })}
        >
          {busy ? t("auth.working") : t("settings.devices.disconnect")}
        </button>
      </Form>
    </li>
  );
}

function DangerSubmit({ children }: { children: string }) {
  const { t } = useT();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" && navigation.formData?.get("intent") === "delete";
  return (
    <button
      type="submit"
      name="intent"
      value="delete"
      className="button button-danger"
      disabled={navigation.state === "submitting"}
    >
      {busy ? t("auth.working") : children}
    </button>
  );
}
