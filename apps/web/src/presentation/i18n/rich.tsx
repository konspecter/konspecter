import { Fragment, type ReactNode } from "react";
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
  const message = t(key, params);
  return message.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    const part = name === undefined ? undefined : parts[name];
    return <Fragment key={index}>{part ?? piece}</Fragment>;
  });
}
