import { Fragment, type ReactNode } from "react";

/**
 * A translated message whose `{name}` placeholders are React elements (a
 * link, code): `richText(t("hint"), { tag: <code>#tag</code> })`.
 * Placeholders without a part stay as written.
 */
export function richText(message: string, parts: Readonly<Record<string, ReactNode>>): ReactNode {
  return message.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    const part = name === undefined ? undefined : parts[name];
    return <Fragment key={index}>{part ?? piece}</Fragment>;
  });
}
