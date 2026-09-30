import type { MarkdownViewProps } from "./MarkdownView";
import { ErrorState } from "../components/ErrorState";
import { moduleLoader, useModule } from "../hooks/use-module";
import { t } from "../i18n/i18n";

// Only notes the text editor cannot represent are shown rendered; load the
// renderer (react-markdown, highlighting) for them alone.
const reader = moduleLoader(() => import("./MarkdownView"));

/** Loads the renderer ahead of the first rendered note (when the browser is idle). */
export function preloadReader(): Promise<typeof import("./MarkdownView")> {
  return reader.load();
}

export function LazyMarkdownView(props: MarkdownViewProps) {
  const loaded = useModule(reader);
  if (loaded.status === "error") {
    return <ErrorState title={t("editor.readerLoadFailed")} error={loaded.error} />;
  }
  if (loaded.status === "loading") return null;
  const { MarkdownView } = loaded.module;
  return <MarkdownView {...props} />;
}
