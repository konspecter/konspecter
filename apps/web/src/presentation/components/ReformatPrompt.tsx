import { useEffect, useMemo, useState } from "react";
import type { FolderReformat, LibraryControls } from "../app/library";
import { useLibraryFolders } from "../hooks/use-library-folders";
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
export function ReformatPrompt({
  folder,
  reformat,
  onSettled,
}: {
  folder: string;
  reformat: FolderReformat;
  /** Nothing (more) to ask for this folder. */
  onSettled?: () => void;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (wasAsked(folder)) {
      onSettled?.();
      return;
    }
    let current = true;
    reformat.misplaced().then(
      (paths) => {
        if (!current) return;
        setCount(paths.length);
        if (paths.length === 0) onSettled?.();
      },
      (error: unknown) => {
        reportError(error);
        if (current) onSettled?.();
      },
    );
    return () => {
      current = false;
    };
  }, [folder, reformat, onSettled]);
  if (count === 0) return null;
  return (
    <ReformatDialog
      count={count}
      onAnswer={(yes) => {
        rememberAsked(folder);
        setCount(0);
        onSettled?.();
        if (yes) reformat.apply().catch(reportError);
      }}
    />
  );
}

/** Asks about each open folder in turn (`ReformatPrompt`), one question at a time. */
export function ReformatPrompts({ library }: { library: LibraryControls }) {
  const folders = useLibraryFolders(library).filter((folder) => folder.available);
  const [index, setIndex] = useState(0);
  const folder = folders[index];
  const id = folder?.id;
  const reformat = useMemo(() => (id === undefined ? null : library.reformat(id)), [library, id]);
  const next = useMemo(
    () => () => {
      setIndex((current) => (current === index ? current + 1 : current));
    },
    [index],
  );
  if (!folder || !reformat) return null;
  return (
    <ReformatPrompt key={folder.id} folder={folder.path} reformat={reformat} onSettled={next} />
  );
}
