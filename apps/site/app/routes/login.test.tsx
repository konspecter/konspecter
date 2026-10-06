import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import App from "../root";
import Login from "./login";

function renderLogin(
  action: () => unknown,
  loaded: { providers: string[]; next: string; error: unknown } = {
    providers: [],
    next: "/",
    error: null,
  },
  path = "/login",
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale: "en", theme: "system", email: null, name: "", accounts: true }),
      children: [{ path: "login", Component: Login as never, action, loader: () => loaded }],
    },
  ]);
  render(<Stub initialEntries={[path]} />);
}

it("asks for a code first and shows the password only when asked to", async () => {
  renderLogin(() => null);
  const user = userEvent.setup();
  expect(await screen.findByRole("button", { name: "Email me a code" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByRole("link", { name: "Forgot your password?" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Use password" }));
  expect(screen.getByLabelText("Password")).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Email me a code" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use password" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Forgot your password?" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Without password" }));
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.getByRole("button", { name: "Email me a code" })).toBeInTheDocument();
});

it("shows the API's error next to the form and keeps the address", async () => {
  renderLogin(() => ({
    email: "ann@example.com",
    mode: "password",
    error: { code: "invalid_credentials" },
  }));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Email" }), "ann@example.com");
  await user.click(screen.getByRole("button", { name: "Use password" }));
  await user.type(screen.getByLabelText("Password"), "wrong");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The email or password is wrong.");
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ann@example.com");
  expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
    "href",
    "/forgot",
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.queryByRole("list", { name: "Sign in with another service" })).toBeNull();
});

it("offers the server's providers as links that keep the return path", async () => {
  renderLogin(() => null, { providers: ["google", "x"], next: "/settings", error: null });
  const list = await screen.findByRole("list", { name: "Sign in with another service" });
  expect(list).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
    "href",
    "/api/auth/google/start?next=%2Fsettings",
  );
  expect(screen.getByRole("link", { name: "Continue with X" })).toHaveAttribute(
    "href",
    "/api/auth/x/start?next=%2Fsettings",
  );
  expect(screen.getByText("or with your email")).toBeInTheDocument();
});

it("says why a provider sign-in came back", async () => {
  renderLogin(() => null, {
    providers: ["google"],
    next: "/",
    error: { code: "oauth_cancelled" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in was cancelled.");
  expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
    "href",
    "/api/auth/google/start",
  );
});
