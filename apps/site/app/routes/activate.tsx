import { richText } from "@konspecter/i18n/rich";
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { requireUser, signInPath } from "../account.server";
import { callApi } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { parseClient, type DeviceClient } from "../devices";
import { useT } from "../i18n/i18n";
import type { Route } from "./+types/activate";

/**
 * Connecting an app: the app shows a code and opens this page with it
 * (`/activate?code=BCDF-GHJK`), or its owner types the code in. Signed in,
 * they compare the codes and approve or deny the app.
 */

/** A code as the app shows it: upper case, "BCDF-GHJK". */
export function displayCode(input: string): string {
  const letters = input.toUpperCase().replace(/[\s-]/g, "");
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(request, context);
  const code = displayCode(new URL(request.url).searchParams.get("code")?.trim() ?? "");
  if (!code) return { email: user.email, code, device: null, error: null };
  const result = await callApi<{ device?: unknown }>(
    request,
    `/api/devices/pending?user_code=${encodeURIComponent(code)}`,
  );
  if (result.status === 401) throw redirect(signInPath(request));
  const device = parseClient(result.data?.device);
  if (!device) {
    const error = formError(result.error?.code ?? "internal", result.retryAfter);
    return { email: user.email, code, device: null, error };
  }
  return { email: user.email, code, device, error: null };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const approve = form.get("intent") === "approve";
  const result = await callApi<{ device?: unknown }>(
    request,
    approve ? "/api/devices/approve" : "/api/devices/deny",
    { method: "POST", body: { user_code: textField(form, "code") } },
  );
  if (result.status === 401) throw redirect(signInPath(request));
  if (result.error) {
    return data(
      { decision: null, device: null, error: formError(result.error.code, result.retryAfter) },
      result.status,
    );
  }
  return {
    decision: approve ? ("approved" as const) : ("denied" as const),
    device: parseClient(result.data?.device),
    error: null,
  };
}

export default function Activate() {
  const { t } = useT();
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  if (result?.decision === "approved") {
    return (
      <AuthPage title={t("activate.approvedTitle")}>
        <p className="form-notice" role="status">
          {t("activate.approved", { name: result.device?.name ?? "Konspecter" })}
        </p>
        <p className="auth-links">
          <Link to="/settings">{t("activate.toSettings")}</Link>
        </p>
      </AuthPage>
    );
  }
  if (result?.decision === "denied") {
    return (
      <AuthPage title={t("activate.deniedTitle")}>
        <p className="form-notice" role="status">
          {t("activate.denied")}
        </p>
      </AuthPage>
    );
  }
  if (loaded.device) {
    return (
      <AuthPage
        title={t("activate.title")}
        lead={richText(t("activate.lead"), {
          email: <strong className="auth-email">{loaded.email}</strong>,
        })}
      >
        <DeviceCode code={loaded.code} device={loaded.device} />
        <Form method="post" className="form">
          <input type="hidden" name="code" value={loaded.code} />
          <p className="activate-warning">{t("activate.warning")}</p>
          <FormMessage error={result?.error ?? null} />
          <div className="actions">
            <Submit intent="approve">{t("activate.approve")}</Submit>
            <Submit intent="deny" primary={false}>
              {t("activate.deny")}
            </Submit>
          </div>
        </Form>
      </AuthPage>
    );
  }
  return (
    <AuthPage title={t("activate.title")} lead={t("activate.enterLead")}>
      {/* A GET form: the code goes into the address, as the app's link puts it. */}
      <Form method="get" className="form">
        <Field
          label={t("activate.codeLabel")}
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          autoFocus
          defaultValue={loaded.code}
          className="code-input activate-code-input"
        />
        <FormMessage error={loaded.error} />
        <div className="actions">
          <Submit>{t("activate.continue")}</Submit>
        </div>
      </Form>
    </AuthPage>
  );
}

/** The code to compare with the app's, and the app that sent it. */
function DeviceCode({ code, device }: { code: string; device: DeviceClient }) {
  const { t } = useT();
  const platform = t(`device.platform.${device.platform}`);
  return (
    <figure className="device-code">
      <p className="device-code-value" aria-label={t("activate.codeLabelled", { code })}>
        {code}
      </p>
      <figcaption>
        <span className="device-name">{device.name}</span>
        <span className="device-meta">
          {device.clientVersion
            ? t("settings.devices.platformVersion", {
                platform,
                version: device.clientVersion,
              })
            : platform}
        </span>
      </figcaption>
    </figure>
  );
}
