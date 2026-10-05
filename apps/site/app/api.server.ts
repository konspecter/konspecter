import { siteConfig } from "./config.server";

/**
 * Calls the Go API from the site's server on the visitor's behalf. The
 * visitor's cookie (their session), Origin, language, user agent and
 * forwarded address go along, so the API sees the same visitor the site
 * does; cookies the API sets come back to be passed on to the browser.
 */
export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export interface ApiResult<T> {
  readonly status: number;
  readonly data: T | null;
  readonly error: ApiError | null;
  /** Set-Cookie headers from the API (the session cookie), for the site's response. */
  readonly cookies: readonly string[];
  /** Seconds to wait, from Retry-After on 429. */
  readonly retryAfter: number | null;
}

const FORWARDED = ["Cookie", "Origin", "Accept-Language", "User-Agent", "X-Forwarded-For"];
const TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseError(body: unknown): ApiError | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { code, message } = body.error;
  return typeof code === "string"
    ? { code, message: typeof message === "string" ? message : "" }
    : null;
}

function parseJSON(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

export async function callApi<T>(
  request: Request,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetcher: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  const headers = new Headers({ Accept: "application/json" });
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetcher(`${siteConfig().apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (error) {
    console.error(`API ${path} unreachable:`, error);
    return {
      status: 503,
      data: null,
      error: { code: "unreachable", message: "the API is unreachable" },
      cookies: [],
      retryAfter: null,
    };
  }

  const text = await response.text();
  const body = parseJSON(text);
  const retryAfter = Number(response.headers.get("Retry-After"));
  return {
    status: response.status,
    data: response.ok ? (body as T) : null,
    error: response.ok
      ? null
      : (parseError(body) ?? { code: "internal", message: text.slice(0, 200) }),
    cookies: response.headers.getSetCookie(),
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}

/** Headers carrying the API's cookies to the browser, plus any of the site's own. */
export function withCookies(cookies: readonly string[], extra: readonly string[] = []): Headers {
  const headers = new Headers();
  for (const cookie of [...cookies, ...extra]) headers.append("Set-Cookie", cookie);
  return headers;
}

export interface SignedInUser {
  readonly id: string;
  readonly email: string;
}

/** The visitor's account (from their session cookie), or null; `enabled` is false when the server has sign-in off. */
export async function currentUser(
  request: Request,
): Promise<{ user: SignedInUser | null; enabled: boolean }> {
  const result = await callApi<SignedInUser>(request, "/api/me");
  if (result.data && typeof result.data.email === "string") {
    return { user: { id: result.data.id, email: result.data.email }, enabled: true };
  }
  return { user: null, enabled: result.error?.code !== "not_configured" };
}
