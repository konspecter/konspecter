import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { vi } from "vitest";
import App from "../root";
import LoginCode from "./login-code";

function renderCode(action: (args: { request: Request }) => unknown) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: App as never,
      loader: () => ({ locale: "en", theme: "system", email: null, accounts: true }),
      children: [
        {
          path: "login/code",
          Component: LoginCode as never,
          loader: () => ({ email: "ann@example.com", mode: "login" }),
          action,
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/login/code"]} />);
}

it("sends a pasted code at once", async () => {
  const sent = vi.fn<(form: FormData) => void>();
  renderCode(async ({ request }) => {
    sent(await request.formData());
    return { error: { code: "invalid_code" }, resent: false };
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("textbox", { name: "Code" }));
  // As copied from the email: the code's line is indented.
  await user.paste("    123 456\n");

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(sent).toHaveBeenCalledOnce();
  const form = sent.mock.calls[0]?.[0];
  expect(form?.get("code")).toBe("123456");
  expect(form?.get("intent")).toBe("verify");
});

it("waits for Continue when the code is typed or only part of it is pasted", async () => {
  const sent = vi.fn();
  renderCode(() => {
    sent();
    return { error: null, resent: false };
  });
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", { name: "Code" });
  await user.click(input);
  await user.paste("123");
  await user.type(input, "456");

  expect(input).toHaveValue("123456");
  expect(sent).not.toHaveBeenCalled();
});
