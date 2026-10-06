import { DocumentIcon } from "@konspecter/ui/icons";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useT } from "./i18n/i18n";
import type { Specimen, SpecimenLine } from "./specimen";

/**
 * The landing page's one picture: conspects as the files Konspecter keeps,
 * one per kind of reader, sliding by on their own. Every few seconds the
 * current file drifts left and fades into nothing while the next comes in
 * from the right, round and round. It waits while the pointer or the focus
 * is on it, while the page is hidden, and for people who prefer less motion;
 * the dots choose a file. Without the script the first file stands still.
 */

/** How long a file stays before the next comes in. */
export const SLIDE_EVERY_MS = 5_000;

function prefersLessMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SpecimenSlider({ specimens }: { specimens: readonly Specimen[] }) {
  const { t } = useT();
  const [current, setCurrent] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  // A turn skipped while the page was hidden; counting it sets the next timer.
  const [skipped, setSkipped] = useState(0);
  const count = specimens.length;

  function show(index: number) {
    if (index === current) return;
    setLeaving(current);
    setCurrent(index);
  }

  // One timer per file shown: choosing a file with a dot starts the wait anew.
  useEffect(() => {
    if (held || count < 2) return;
    if (prefersLessMotion()) return;
    const timer = setTimeout(() => {
      if (document.hidden) {
        setSkipped((turns) => turns + 1);
        return;
      }
      setLeaving(current);
      setCurrent((current + 1) % count);
    }, SLIDE_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [current, held, count, skipped]);

  return (
    <figure
      className="specimen"
      aria-roledescription="carousel"
      aria-label={t("home.specimenLabel")}
      onMouseEnter={() => {
        setHeld(true);
      }}
      onMouseLeave={() => {
        setHeld(false);
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false);
      }}
    >
      <div className="specimen-slides" aria-live={held ? "polite" : "off"}>
        {specimens.map((specimen, index) => {
          const state = index === current ? "current" : index === leaving ? "leaving" : "waiting";
          return (
            <SpecimenFile
              key={specimen.id}
              specimen={specimen}
              state={state}
              label={t("home.exampleOf", {
                name: t(`home.example.${specimen.id}`),
                index: index + 1,
                count,
              })}
            />
          );
        })}
      </div>
      <div className="specimen-dots" role="group" aria-label={t("home.examples")}>
        {specimens.map((specimen, index) => (
          <button
            key={specimen.id}
            type="button"
            className="specimen-dot"
            aria-label={t(`home.example.${specimen.id}`)}
            title={t(`home.example.${specimen.id}`)}
            aria-current={index === current ? "true" : undefined}
            onClick={() => {
              show(index);
            }}
          />
        ))}
      </div>
    </figure>
  );
}

function SpecimenFile({
  specimen,
  state,
  label,
}: {
  specimen: Specimen;
  state: "current" | "leaving" | "waiting";
  label: string;
}) {
  const last = specimen.lines.length - 1;
  const shown = state === "current";
  return (
    <div
      className={`specimen-slide is-${state}`}
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={!shown}
      inert={!shown}
    >
      <p className="specimen-file">
        <DocumentIcon />
        {specimen.file}
      </p>
      <pre className="specimen-source">
        <code>
          {specimen.lines.map((line, index) => (
            <span key={index} className={line.kind === "code" ? "md-line md-code-line" : "md-line"}>
              <Line line={line} />
              {index === last && shown && <span className="caret" aria-hidden="true" />}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Inline `code` spans and #tags of a source line, coloured as the Markdown editor does. */
function sourceText(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((piece, index) =>
    piece.startsWith("`") ? (
      <span key={index} className="md-code">
        {piece}
      </span>
    ) : (
      <Fragment key={index}>{piece}</Fragment>
    ),
  );
}

function Line({ line }: { line: SpecimenLine }) {
  switch (line.kind) {
    case "fence":
      return <span className="md-fence">---</span>;
    case "blank":
      return null;
    case "meta":
      return (
        <>
          <span className="md-key">{line.key}:</span> {line.value}
        </>
      );
    case "heading":
      return <span className="md-heading">{line.text}</span>;
    case "codeFence":
      return <span className="md-fence">{line.text}</span>;
    case "code":
      return <span className="md-block">{line.text}</span>;
    case "tags":
      return line.text.split(" ").map((tag, index) => (
        <Fragment key={tag}>
          {index > 0 && " "}
          <span className="md-tag">{tag}</span>
        </Fragment>
      ));
    case "text":
      return sourceText(line.text);
  }
}
