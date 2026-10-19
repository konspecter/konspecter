import { TelegramIcon, VkIcon } from "@konspecter/ui/icons";
import type { ComponentType } from "react";
import { useT } from "./i18n/i18n";
import { TELEGRAM, VK } from "./links";

/**
 * Where to find Konspecter, in the order the footer shows them. A new channel
 * is one more entry here, its mark in @konspecter/ui/icons and its name as
 * `contacts.<id>` in every language.
 */
export const CONTACTS = [
  { id: "telegram", href: TELEGRAM, Icon: TelegramIcon },
  { id: "vk", href: VK, Icon: VkIcon },
] as const satisfies readonly { id: string; href: string; Icon: ComponentType }[];

/** The channels, each a link with its mark and its name. */
export function Contacts() {
  const { t } = useT();
  return (
    <nav aria-label={t("contacts.label")} className="site-contacts">
      <ul>
        {CONTACTS.map(({ id, href, Icon }) => (
          <li key={id}>
            <a href={href}>
              <Icon />
              {t(`contacts.${id}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
