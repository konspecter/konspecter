import { createContext, redirect, type RouterContextProvider } from "react-router";
import { currentUser, type SignedInUser } from "./api.server";
import { safeReturnPath } from "./preferences.server";

/** Who is signed in, asked once per request by the root middleware. */
export interface Account {
  readonly user: SignedInUser | null;
  /** False when the server has sign-in off. */
  readonly enabled: boolean;
}

export const accountContext = createContext<Account>({ user: null, enabled: true });

export async function loadAccount(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<void> {
  context.set(accountContext, await currentUser(request));
}

/** Where to go after signing in: the `next` parameter if it is a path on this site. */
export function nextPath(request: Request): string {
  return safeReturnPath(new URL(request.url).searchParams.get("next"));
}

/** The signed-in user, or a redirect to sign in that comes back to this page. */
export function requireUser(
  request: Request,
  context: Readonly<RouterContextProvider>,
): SignedInUser {
  const { user } = context.get(accountContext);
  if (!user) throw redirect(signInPath(request));
  return user;
}

/** The sign-in page, returning to the request's page afterwards. */
export function signInPath(request: Request): string {
  const url = new URL(request.url);
  return `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/** Sends a signed-in visitor on from the sign-in pages. */
export function redirectIfSignedIn(
  request: Request,
  context: Readonly<RouterContextProvider>,
): void {
  if (context.get(accountContext).user) throw redirect(nextPath(request));
}
