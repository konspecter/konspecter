import { errorText, formError } from "./auth-form";
import { translator } from "./i18n/i18n";

const { t } = translator("en");

it("explains each API error in the visitor's words", () => {
  expect(errorText(t, { code: "invalid_credentials" })).toBe("The email or password is wrong.");
  expect(errorText(t, { code: "mail_failed" })).toBe(
    "The email could not be sent. Try again later.",
  );
  expect(errorText(t, { code: "mail_unavailable" })).toBe(errorText(t, { code: "mail_failed" }));
  expect(errorText(t, { code: "forbidden_origin" })).toBe(
    "Something went wrong on the server. Try again in a moment.",
  );
});

it("says how long to wait after too many attempts", () => {
  expect(formError("rate_limited", 61)).toEqual({ code: "rate_limited", minutes: 2 });
  expect(errorText(t, formError("rate_limited", 61))).toBe(
    "Too many attempts. Try again in 2 min.",
  );
  expect(errorText(translator("ru").t, formError("rate_limited", 10))).toBe(
    "Слишком много попыток. Попробуйте снова через 1 мин.",
  );
});
