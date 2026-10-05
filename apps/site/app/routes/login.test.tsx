import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import App from "../root";
import Login from "./login";

function renderLogin(action: () => unknown) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale: "en", theme: "system", email: null, accounts: true }),
      children: [{ path: "login", Component: Login as never, action }],
    },
  ]);
  render(<Stub initialEntries={["/login"]} />);
}

it("shows the API's error next to the form and keeps the address", async () => {
  renderLogin(() => ({ email: "ann@example.com", error: { code: "invalid_credentials" } }));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Email" }), "ann@example.com");
  await user.type(screen.getByLabelText("Password"), "wrong");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The email or password is wrong.");
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ann@example.com");
  expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
    "href",
    "/forgot",
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});
