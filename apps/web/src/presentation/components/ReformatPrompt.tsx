import { useEffect, useState } from "react";
import type { FolderReformat } from "../app/library";
import { reportError } from "../app/errors";
import { t, tn } from "../i18n/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

/** Asks whether to move `count` files into their tags' folders. */
export function ReformatDialog({
  count,
  onAnswer,
}: {
  count: number;
  onAnswer: (reformat: boolean) => void;
}) {
  return (
    <ConfirmDialog
      title={t("reformat.title")}
      message={tn("reformat.message", count)}
      confirmLabel={t("reformat.confirm")}
      cancelLabel={t("reformat.keep")}
      onConfirm={() => {
        onAnswer(true);
      }}
      onCancel={() => {
        onAnswer(false);
      }}
    />
  );
}

const askedKey = (folder: string) => `konspecter.reformat:${folder}`;

function wasAsked(folder: string): boolean {
  try {
    return localStorage.getItem(askedKey(folder)) !== null;
  } catch {
    return false;
  }
}

function rememberAsked(folder: string): void {
  try {
    localStorage.setItem(askedKey(folder), "asked");
  } catch {
    // Without storage the question comes again next time.
  }
}

/**
 * File Mode: the first time a folder opens with files that have tags but are
 * not in their tags' folders, asks whether to reformat the collection
 * (ADR-013). Either answer is remembered for the folder; Settings can
 * reformat later.
 */
export function ReformatPrompt({ folder, reformat }: { folder: string; reformat: FolderReformat }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (wasAsked(folder)) return;
    let current = true;
    reformat.misplaced().then((paths) => {
      if (current) setCount(paths.length);
    }, reportError);
    return () => {
      current = false;
    };
  }, [folder, reformat]);
  if (count === 0) return null;
  return (
    <ReformatDialog
      count={count}
      onAnswer={(yes) => {
        rememberAsked(folder);
        setCount(0);
        if (yes) reformat.apply().catch(reportError);
      }}
    />
  );
}
