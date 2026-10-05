import type { ReactNode } from "react";
import { richText } from "@konspecter/i18n/rich";
import { t, type Params, type TextKey } from "./i18n";

/**
 * A message whose `{name}` placeholders are React elements (a link, code):
 * `rich("sidebar.tagsHint", { tag: <code>#tag</code> })`. Text placeholders
 * can be passed as `params`.
 */
export function rich(
  key: TextKey,
  parts: Readonly<Record<string, ReactNode>>,
  params?: Params,
): ReactNode {
  return richText(t(key, params), parts);
}
