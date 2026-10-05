import type { ReactElement } from "react";
import { useT } from "./i18n/i18n";

/**
 * Sign-in with other services: a button per provider the server offers in
 * the visitor's language. Each is a plain link to the API's start, which
 * sends the browser on to the provider, so no JavaScript is needed.
 *
 * The marks are in the providers' own colours; X is drawn in the text colour
 * so it follows the theme. They are decorative: the text names the provider.
 */
export type ProviderId = "google" | "linkedin" | "x" | "yandex" | "vk";

export const PROVIDER_IDS: readonly ProviderId[] = ["google", "linkedin", "x", "yandex", "vk"];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

const marks: Record<ProviderId, ReactElement> = {
  google: (
    <svg viewBox="0 0 256 262">
      <path
        fill="#4285F4"
        d="M255.9 133.5c0-10.7-.9-18.6-2.8-26.7H130.6v48.4h71.9c-1.4 12-9.3 30.2-26.7 42.4l38.8 30 2.7.2c24.6-22.8 38.8-56.3 38.8-96z"
      />
      <path
        fill="#34A853"
        d="M130.6 261.1c35.2 0 64.8-11.6 86.4-31.6l-41.2-31.9c-11 7.7-25.8 13-45.2 13-34.5 0-63.8-22.7-74.3-54.2l-1.5.1-40.3 31.2-.5 1.5c21.5 42.6 65.6 71.9 116.6 71.9z"
      />
      <path
        fill="#FBBC05"
        d="M56.3 156.4c-2.8-8.1-4.4-16.8-4.4-25.8s1.6-17.7 4.2-25.8l-.1-1.7-40.8-31.7-1.3.6C5.1 89.6 0 109.5 0 130.6s5.1 40.9 13.9 58.6l42.4-32.8z"
      />
      <path
        fill="#EB4335"
        d="M130.6 50.5c24.5 0 41 10.6 50.4 19.4l36.9-36C195.2 12.9 165.8 0 130.6 0 79.5 0 35.4 29.3 13.9 71.9l42.2 32.8c10.6-31.5 39.9-54.2 74.5-54.2z"
      />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 256 256">
      <path
        fill="#0A66C2"
        d="M218.1 218.1h-37.9v-59.4c0-14.2-.3-32.4-19.7-32.4-19.8 0-22.8 15.4-22.8 31.4v60.4H99.8V96h36.4v16.7h.5c7.4-12.7 21.2-20.3 35.9-19.7 38.4 0 45.5 25.3 45.5 58.2v67zM57 79.3a22 22 0 1 1 0-44 22 22 0 0 1 0 44zm19 138.8H38V96h38v122.1zM237 0H18.9C8.6-.1.1 8.2 0 18.5v219C.1 247.8 8.6 256.1 18.9 256H237c10.4.1 18.9-8.1 19-18.5v-219C255.9 8.1 247.4-.1 237 0z"
      />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.25 6.94zm-1.29 19.5h2.04L6.49 3.24H4.3z"
      />
    </svg>
  ),
  yandex: (
    <svg viewBox="0 0 256 256">
      <circle cx="128" cy="128" r="128" fill="#FC3F1D" />
      <path
        fill="#fff"
        transform="translate(92.6 55.5) scale(.82)"
        d="M83.1 0H56.3C29.4 0 6.3 20 6.3 58.8c0 23.1 11.2 40.6 30.6 49.4L.6 173.2c-1.2 1.9 0 3.7 1.9 3.7h16.9c1.2 0 2.5-.6 3.1-1.9l33.1-63.7h11.9v63.8c0 .6.6 1.9 1.9 1.9h15c1.3 0 1.9-.6 1.9-1.9V2.5C85.6.6 85 0 83.1 0zM67.5 96.3h-10c-43.1 0-40-81.3-1.9-81.3h12.5v81.3z"
      />
    </svg>
  ),
  vk: (
    <svg viewBox="0 0 24 24">
      <rect width="24" height="24" rx="7" fill="#0077FF" />
      <path
        fill="#fff"
        transform="translate(3.6 3.6) scale(.7)"
        d="M13.16 18.99c.61 0 .86-.4.85-.91-.03-1.92.71-2.95 2.06-1.6 1.49 1.49 1.8 2.51 3.6 2.51h3.2c.81 0 1.13-.26 1.13-.67 0-.86-1.42-2.38-2.63-3.5-1.69-1.57-1.76-1.6-.31-3.49 1.8-2.34 4.16-5.33 2.07-5.33h-3.98c-.77 0-.83.43-1.1 1.08-1 2.35-2.89 5.39-3.6 4.92-.76-.49-.41-2.41-.35-5.26.01-.75.01-1.27-1.14-1.54a8.4 8.4 0 0 0-1.81-.2c-2.28 0-3.84.95-2.95 1.12 1.57.29 1.42 3.69 1.05 5.16-.64 2.56-3.03-2.02-4.03-4.3-.24-.55-.32-.98-1.18-.98H.78c-.5 0-.78.16-.78.52 0 .6 2.96 6.72 5.79 9.77 2.75 2.97 5.48 2.7 7.37 2.7z"
      />
    </svg>
  ),
};

function ProviderMark({ id }: { id: ProviderId }) {
  return (
    <span className="provider-mark" aria-hidden="true">
      {marks[id]}
    </span>
  );
}

/** The provider buttons and the line that leads on to the email form; nothing without providers. */
export function ProviderButtons({
  providers,
  next,
}: {
  providers: readonly ProviderId[];
  next: string;
}) {
  const { t } = useT();
  if (providers.length === 0) return null;
  const query = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <>
      <ul className="providers" aria-label={t("providers.label")}>
        {providers.map((id) => (
          <li key={id}>
            <a className="button provider-button" href={`/api/auth/${id}/start${query}`}>
              <ProviderMark id={id} />
              {t(`provider.${id}`)}
            </a>
          </li>
        ))}
      </ul>
      <p className="providers-or">{t("providers.or")}</p>
    </>
  );
}
