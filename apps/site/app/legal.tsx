import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Operator } from "./config.server";
import type { Locale, SiteTranslator } from "./i18n/i18n";
import { day, durationText, money, periodText, type Plans } from "./subscription";

/**
 * The terms (a public offer, where sync is paid) and the privacy policy,
 * in each language. They are templates of the usual kind: the operator's
 * details come from the site's settings and the prices from the server, and
 * whoever runs a server should have them read by a lawyer where they work.
 */

/** When the texts last changed. */
export const LEGAL_UPDATED = "2026-10-06";

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly ReactNode[];
}

export interface LegalDocument {
  readonly title: string;
  readonly lead: string;
  readonly sections: readonly LegalSection[];
}

export interface LegalContext {
  readonly locale: Locale;
  readonly t: SiteTranslator;
  readonly operator: Operator;
  /** The site's address, as people type it ("notes.example.com"). */
  readonly host: string;
  readonly plans: Plans;
}

/** The cookies the site sets: each one needed for it to work. */
export const COOKIES = [
  { name: "ksp_session", purpose: "session", lifetime: "session" },
  { name: "ksp_pending", purpose: "pending", lifetime: "minutes" },
  { name: "ksp_oauth", purpose: "oauth", lifetime: "minutes" },
  { name: "ksp_link", purpose: "link", lifetime: "minutes" },
  { name: "lang", purpose: "lang", lifetime: "year" },
  { name: "theme", purpose: "theme", lifetime: "year" },
  { name: "cookies", purpose: "notice", lifetime: "year" },
] as const;

function operatorName(c: LegalContext): string {
  if (c.operator.name) return c.operator.name;
  return c.locale === "ru" ? `оператор сервера ${c.host}` : `the operator of ${c.host}`;
}

function contact(c: LegalContext): ReactNode {
  if (c.operator.email) return <a href={`mailto:${c.operator.email}`}>{c.operator.email}</a>;
  return c.locale === "ru" ? "адресу, указанному на этом сайте" : "the address given on this site";
}

/** The operator's details, one line each; only those set. */
function details(c: LegalContext): ReactNode[] {
  const ru = c.locale === "ru";
  const lines: ReactNode[] = [operatorName(c)];
  if (c.operator.id) lines.push(`${ru ? "ИНН / ОГРН" : "Registration number"}: ${c.operator.id}`);
  if (c.operator.address) lines.push(`${ru ? "Адрес" : "Address"}: ${c.operator.address}`);
  if (c.operator.email)
    lines.push(
      <>
        {ru ? "Эл. почта: " : "Email: "}
        {contact(c)}
      </>,
    );
  return lines;
}

/** The prices, one line each: "$3 every month (the gateway's name)". */
function priceList(c: LegalContext): ReactNode {
  const several = c.plans.gateways.length > 1;
  return (
    <ul>
      {c.plans.gateways.flatMap((gateway) =>
        gateway.prices.map((price) => (
          <li key={`${gateway.id}:${price.period}`}>
            {c.t.t("subscription.option", {
              price: money(price.amount, gateway.currency, c.locale),
              period: periodText(c.t, price.period),
            })}
            {several && ` (${gateway.name})`}
          </li>
        )),
      )}
    </ul>
  );
}

function gateways(c: LegalContext): string {
  return c.plans.gateways.map((gateway) => gateway.name).join(", ");
}

const settings = <Link to="/settings#subscription">/settings</Link>;

export function terms(c: LegalContext): LegalDocument {
  return c.locale === "ru" ? termsRu(c) : termsEn(c);
}

export function privacy(c: LegalContext): LegalDocument {
  return c.locale === "ru" ? privacyRu(c) : privacyEn(c);
}

function termsEn(c: LegalContext): LegalDocument {
  const name = operatorName(c);
  const { paid, trial, grace } = c.plans;
  return {
    title: paid ? "Terms of service and subscription" : "Terms of service",
    lead: `These terms are an offer by ${name} to everyone who uses Konspecter on ${c.host}. Creating an account accepts them; paying for a subscription accepts them for the subscription too.`,
    sections: [
      {
        id: "service",
        title: "1. The service",
        paragraphs: [
          "Konspecter is a notebook. The apps keep your conspects on your devices and work without an account. An account on this server adds sync: the conspects are kept in step between your devices, through the server.",
          "Conspects are encrypted on your devices before they are synced, with a key only your passphrase opens. The server stores them encrypted and cannot read them.",
        ],
      },
      {
        id: "prices",
        title: "2. Prices",
        paragraphs: paid
          ? [
              "Sync is sold as a subscription, at these prices:",
              priceList(c),
              trial
                ? `Every account gets one free trial of ${durationText(c.t, trial)}. It starts when an app of the account first syncs.`
                : "There is no free trial.",
              "The prices include every tax the operator must charge. A price may change; a subscriber is told by email at least 14 days before, and the new price applies from the next period after that.",
            ]
          : ["Sync on this server is free. Nothing here is paid for."],
      },
      ...(paid
        ? [
            {
              id: "payment",
              title: "3. Payment and automatic renewal",
              paragraphs: [
                `Payments are made through ${gateways(c)}. Your card details go to the payment service, never to the operator.`,
                "A subscription renews automatically at the end of every period, for the same period and price, and is charged then, until you cancel it. By subscribing you agree to these automatic payments.",
                "Every payment, renewal, failed payment, cancellation and refund is confirmed by email.",
                grace
                  ? `If a renewal cannot be charged, it is tried again; sync keeps working for ${durationText(c.t, grace)} after the paid time ends, free of charge. Then sync pauses until a payment goes through.`
                  : "If a renewal cannot be charged, it is tried again; sync pauses when the paid time ends, until a payment goes through.",
              ],
            },
            {
              id: "cancel",
              title: "4. Cancelling",
              paragraphs: [
                <>
                  You can cancel at any time in the account settings ({settings}), with one button.
                  Nothing is charged after that; sync keeps working until the end of the time
                  already paid for.
                </>,
                "When sync pauses (cancelled, or not paid), nothing is deleted: your conspects stay on your devices and on the server, and sync carries on where it stopped once you subscribe again. The apps keep working on every device either way.",
              ],
            },
            {
              id: "refunds",
              title: "5. Refunds",
              paragraphs: [
                <>
                  Write to {contact(c)} to ask for a refund. A payment for a period not yet started
                  is refunded in full; other requests are settled as the consumer law that applies
                  to you provides. Refunds go back to where you paid from.
                </>,
              ],
            },
          ]
        : []),
      {
        id: "data",
        title: `${paid ? "6" : "3"}. Your data`,
        paragraphs: [
          <>
            How your data is handled is described in the <Link to="/privacy">privacy policy</Link>.
            Deleting the account (in the settings) deletes everything it keeps on the server.
          </>,
        ],
      },
      {
        id: "liability",
        title: `${paid ? "7" : "4"}. Availability and liability`,
        paragraphs: [
          "The operator keeps the service working with reasonable care, but cannot promise it is never interrupted. Your conspects are always kept on your own devices as well; the server is not their only copy.",
          "As far as the law allows, the operator is not liable for indirect losses. Nothing in these terms limits rights the consumer law gives you.",
        ],
      },
      {
        id: "changes",
        title: `${paid ? "8" : "5"}. Changes`,
        paragraphs: [
          "These terms may change. The current version is always on this page, with its date; subscribers are told by email of changes that concern them.",
        ],
      },
      {
        id: "operator",
        title: `${paid ? "9" : "6"}. The operator`,
        paragraphs: details(c),
      },
    ],
  };
}

function termsRu(c: LegalContext): LegalDocument {
  const name = operatorName(c);
  const { paid, trial, grace } = c.plans;
  return {
    title: paid ? "Публичная оферта и условия использования" : "Условия использования",
    lead: paid
      ? `Этот документ — публичная оферта (ст. 437 ГК РФ) ${name} (далее — «Исполнитель») о предоставлении синхронизации Konspecter на ${c.host}. Оплата подписки — её акцепт (п. 3 ст. 438 ГК РФ). Создавая аккаунт, вы принимаете эти условия в части, не касающейся оплаты.`
      : `Эти условия ${name} (далее — «Исполнитель») действуют для всех, кто пользуется Konspecter на ${c.host}. Создавая аккаунт, вы их принимаете.`,
    sections: [
      {
        id: "service",
        title: "1. Предмет",
        paragraphs: [
          "Konspecter — записная книжка. Приложения хранят конспекты на ваших устройствах и работают без аккаунта. Аккаунт на этом сервере добавляет синхронизацию: конспекты одинаковы на всех ваших устройствах.",
          "Конспекты шифруются на устройствах до синхронизации ключом, который открывает только ваш пароль шифрования. Сервер хранит их зашифрованными и прочитать не может.",
        ],
      },
      {
        id: "prices",
        title: "2. Стоимость",
        paragraphs: paid
          ? [
              "Синхронизация предоставляется по подписке по следующим ценам:",
              priceList(c),
              trial
                ? `Каждый аккаунт один раз получает бесплатный пробный период — ${durationText(c.t, trial)}. Он начинается при первой синхронизации приложения аккаунта.`
                : "Пробного периода нет.",
              "Цены включают все налоги, которые обязан уплатить Исполнитель. Цена может измениться; подписчик узнаёт об этом по электронной почте не позднее чем за 14 дней, и новая цена действует со следующего после этого периода.",
            ]
          : ["Синхронизация на этом сервере бесплатна. Здесь ничего не оплачивается."],
      },
      ...(paid
        ? [
            {
              id: "payment",
              title: "3. Оплата и автоматическое продление",
              paragraphs: [
                `Оплата принимается через ${gateways(c)}. Данные карты получает платёжный сервис; Исполнителю они не передаются.`,
                "Подписка продлевается автоматически в конце каждого периода на тот же период и по той же цене, с автоматическим списанием (автоплатёж), пока вы её не отмените. Оформляя подписку, вы даёте согласие на такие списания.",
                "Каждая оплата, продление, неудачное списание, отмена и возврат подтверждаются письмом на электронную почту аккаунта.",
                grace
                  ? `Если продлить подписку не удалось, списание повторяется; синхронизация бесплатно работает ещё ${durationText(c.t, grace)} после окончания оплаченного времени, затем приостанавливается до оплаты.`
                  : "Если продлить подписку не удалось, списание повторяется; синхронизация приостанавливается по окончании оплаченного времени до оплаты.",
              ],
            },
            {
              id: "cancel",
              title: "4. Отмена подписки",
              paragraphs: [
                <>
                  Отменить подписку можно в любой момент в настройках аккаунта ({settings}) одной
                  кнопкой. После отмены деньги не списываются; синхронизация работает до конца уже
                  оплаченного времени.
                </>,
                "Когда синхронизация приостановлена (подписка отменена или не оплачена), ничего не удаляется: конспекты остаются на ваших устройствах и на сервере, а после новой оплаты синхронизация продолжается с того же места. Приложения на устройствах работают в любом случае.",
              ],
            },
            {
              id: "refunds",
              title: "5. Возврат денег",
              paragraphs: [
                <>
                  Чтобы вернуть деньги, напишите на {contact(c)}. Оплата периода, который ещё не
                  начался, возвращается полностью; остальные обращения рассматриваются в порядке,
                  установленном Законом РФ «О защите прав потребителей». Деньги возвращаются тем же
                  способом, которым была оплата.
                </>,
              ],
            },
          ]
        : []),
      {
        id: "data",
        title: `${paid ? "6" : "3"}. Ваши данные`,
        paragraphs: [
          <>
            Как обрабатываются ваши данные, описано в{" "}
            <Link to="/ru/privacy">политике конфиденциальности</Link>. Удаление аккаунта (в
            настройках) удаляет всё, что он хранит на сервере.
          </>,
        ],
      },
      {
        id: "liability",
        title: `${paid ? "7" : "4"}. Доступность и ответственность`,
        paragraphs: [
          "Исполнитель поддерживает работу сервиса с разумной заботой, но не может обещать, что он никогда не прерывается. Конспекты всегда хранятся и на ваших устройствах; сервер — не единственная их копия.",
          "В пределах, допустимых законом, Исполнитель не отвечает за косвенные убытки. Ничто в этих условиях не ограничивает права, которые дают вам законы о защите прав потребителей.",
        ],
      },
      {
        id: "changes",
        title: `${paid ? "8" : "5"}. Изменения`,
        paragraphs: [
          "Условия могут меняться. Действующая редакция всегда на этой странице, с датой; об изменениях, которые их касаются, подписчики узнают по электронной почте.",
        ],
      },
      {
        id: "operator",
        title: `${paid ? "9" : "6"}. Реквизиты Исполнителя`,
        paragraphs: details(c),
      },
    ],
  };
}

function cookieTable(c: LegalContext): ReactNode {
  const t = c.t.t;
  return (
    <table className="legal-table">
      <thead>
        <tr>
          <th scope="col">{t("cookies.name")}</th>
          <th scope="col">{t("cookies.purpose")}</th>
          <th scope="col">{t("cookies.lifetime")}</th>
        </tr>
      </thead>
      <tbody>
        {COOKIES.map((cookie) => (
          <tr key={cookie.name}>
            <td>
              <code>{cookie.name}</code>
            </td>
            <td>{t(`cookies.purpose.${cookie.purpose}`)}</td>
            <td>{t(`cookies.lifetime.${cookie.lifetime}`)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function privacyEn(c: LegalContext): LegalDocument {
  const name = operatorName(c);
  const paid = c.plans.paid;
  return {
    title: "Privacy policy",
    lead: `How ${name} handles personal data on ${c.host}. In short: the conspects are encrypted so that nobody but you can read them, the rest is kept only to run your account, and nothing is sold or shown to advertisers.`,
    sections: [
      {
        id: "data",
        title: "1. What is kept",
        paragraphs: [
          "Your account: the email address, the name you may give, a password hash if you set a password, and the services you sign in with (Google, Yandex and so on).",
          "Your devices: their names, platforms and app versions, and when they last synced.",
          "Your conspects, encrypted on your devices with a key only your passphrase opens. The server keeps them and the key, locked, and can read neither.",
          ...(paid
            ? [
                "Your subscription: its price and period, the payments (amount, date, status) and the payment service's references. Card details are handled by the payment service and never reach the server.",
              ]
            : []),
          "Technical data: IP addresses and requests, in logs kept for a short time and to stop abuse (such as guessing passwords).",
        ],
      },
      {
        id: "purposes",
        title: "2. Why",
        paragraphs: [
          `To run your account and sync, to send the emails the service needs (sign-in codes${paid ? ", payments and subscription changes" : ""}), and to keep the service secure. There is no advertising, no tracking and no analytics.`,
        ],
      },
      {
        id: "sharing",
        title: "3. Who else sees it",
        paragraphs: [
          paid
            ? `The payment services (${gateways(c)}) get what a payment needs: the amount and your email address. They process your card under their own privacy policies.`
            : "No payment service is involved.",
          "The email service that delivers the server's emails gets your address and those emails. A sign-in service you choose (Google and the others) tells the server your address.",
          "Nothing is sold or given to anyone else, unless the law requires it.",
        ],
      },
      {
        id: "retention",
        title: "4. How long",
        paragraphs: [
          <>
            Everything is kept while the account exists. Deleting the account in the{" "}
            <Link to="/settings#delete">settings</Link> deletes it, conspects included, at once
            {paid
              ? "; records of payments are kept as long as accounting law requires, and only for that"
              : ""}
            . Logs are kept for a few weeks.
          </>,
        ],
      },
      {
        id: "cookies",
        title: "5. Cookies",
        paragraphs: [
          "The site uses only the cookies it needs to work: none track you, none come from others. The apps use none.",
          cookieTable(c),
        ],
      },
      {
        id: "rights",
        title: "6. Your rights",
        paragraphs: [
          <>
            You may see, correct and delete your data: most of it in the settings, the rest by
            writing to {contact(c)}. You may also complain to the data protection authority where
            you live.
          </>,
        ],
      },
      {
        id: "operator",
        title: "7. Who is responsible",
        paragraphs: details(c),
      },
    ],
  };
}

function privacyRu(c: LegalContext): LegalDocument {
  const name = operatorName(c);
  const paid = c.plans.paid;
  return {
    title: "Политика конфиденциальности",
    lead: `Как ${name} (далее — «Оператор») обрабатывает персональные данные на ${c.host} в соответствии с Федеральным законом № 152-ФЗ «О персональных данных». Коротко: конспекты зашифрованы так, что прочитать их можете только вы, остальное хранится только для работы аккаунта, ничего не продаётся и не показывается рекламодателям.`,
    sections: [
      {
        id: "data",
        title: "1. Какие данные хранятся",
        paragraphs: [
          "Аккаунт: адрес электронной почты, имя, если вы его указали, хеш пароля, если вы задали пароль, и сервисы, через которые вы входите (Google, Яндекс и другие).",
          "Устройства: их названия, платформы и версии приложения, время последней синхронизации.",
          "Конспекты, зашифрованные на ваших устройствах ключом, который открывает только ваш пароль шифрования. Сервер хранит их и ключ в запертом виде и не может прочитать ни то, ни другое.",
          ...(paid
            ? [
                "Подписка: цена и период, платежи (сумма, дата, статус) и номера платежей в платёжном сервисе. Данные карты обрабатывает платёжный сервис; на сервер они не попадают.",
              ]
            : []),
          "Технические данные: IP-адреса и запросы — в журналах, которые хранятся недолго, и для защиты от злоупотреблений (например, подбора паролей).",
        ],
      },
      {
        id: "purposes",
        title: "2. Зачем",
        paragraphs: [
          `Чтобы работали аккаунт и синхронизация, чтобы отправлять нужные сервису письма (коды для входа${paid ? ", платежи и изменения подписки" : ""}) и чтобы сервис был защищён. Рекламы, отслеживания и аналитики нет. Основание обработки — исполнение договора (п. 5 ч. 1 ст. 6 152-ФЗ).`,
        ],
      },
      {
        id: "sharing",
        title: "3. Кому передаются",
        paragraphs: [
          paid
            ? `Платёжные сервисы (${gateways(c)}) получают то, что нужно для оплаты: сумму и адрес электронной почты. Карту они обрабатывают по своим политикам.`
            : "Платёжные сервисы не используются.",
          "Почтовый сервис, через который сервер отправляет письма, получает ваш адрес и эти письма. Выбранный вами сервис входа (Google и другие) сообщает серверу ваш адрес.",
          "Больше данные никому не продаются и не передаются, кроме случаев, предусмотренных законом.",
        ],
      },
      {
        id: "retention",
        title: "4. Сроки хранения",
        paragraphs: [
          <>
            Данные хранятся, пока существует аккаунт. Удаление аккаунта в{" "}
            <Link to="/settings#delete">настройках</Link> сразу удаляет их, включая конспекты
            {paid
              ? "; сведения о платежах хранятся столько, сколько требует законодательство о бухгалтерском учёте, и только для этого"
              : ""}
            . Журналы хранятся несколько недель.
          </>,
        ],
      },
      {
        id: "cookies",
        title: "5. Файлы cookie",
        paragraphs: [
          "Сайт использует только те файлы cookie, без которых он не работает: ни один не следит за вами и не принадлежит третьим лицам. Приложения cookie не используют.",
          cookieTable(c),
        ],
      },
      {
        id: "rights",
        title: "6. Ваши права",
        paragraphs: [
          <>
            Вы можете получить, исправить и удалить свои данные: большую часть — в настройках,
            остальное — написав на {contact(c)}, а также отозвать согласие на обработку. Ответ
            даётся в течение 10 рабочих дней. Вы вправе обратиться в Роскомнадзор.
          </>,
        ],
      },
      {
        id: "operator",
        title: "7. Оператор",
        paragraphs: details(c),
      },
    ],
  };
}

/** "Updated 6 October 2026". */
export function updatedText(c: LegalContext): string {
  return c.t.t("legal.updated", { date: day(LEGAL_UPDATED, c.locale) });
}

/** A legal document as a page: title, date, lead, contents and sections. */
export function LegalPage({ document, updated }: { document: LegalDocument; updated: string }) {
  return (
    <article className="legal-page site-frame" aria-labelledby="legal-title">
      <title>{`${document.title} · Konspecter`}</title>
      <h1 id="legal-title">{document.title}</h1>
      <p className="legal-updated">{updated}</p>
      <p className="section-lead">{document.lead}</p>
      <nav aria-label={document.title} className="legal-contents">
        <ol>
          {document.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s*/, "")}</a>
            </li>
          ))}
        </ol>
      </nav>
      {document.sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.paragraphs.map((paragraph, index) =>
            typeof paragraph === "string" || isInline(paragraph) ? (
              <p key={index}>{paragraph}</p>
            ) : (
              <div key={index}>{paragraph}</div>
            ),
          )}
        </section>
      ))}
    </article>
  );
}

/** Text and fragments go in a paragraph; lists and tables stand alone. */
function isInline(node: ReactNode): boolean {
  if (typeof node !== "object" || node === null || !("type" in node)) return true;
  return node.type !== "ul" && node.type !== "table";
}
