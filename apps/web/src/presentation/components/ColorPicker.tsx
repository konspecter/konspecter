import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/i18n";
import {
  RECENT_COLORS,
  colorStyle,
  defaultHue,
  hexToHsl,
  hslToHex,
  recentColors,
  rememberColor,
} from "./note-color";

type ColorPickerProps = {
  /** The note's id: its default colour's hue. */
  id: string;
  /** The note's own colour, or null for its default. */
  color: string | null;
  /** A colour picked, or null for the default (the frontmatter key removed). */
  onPick: (color: string | null) => void;
};

/** Space kept between the popover, its button and the window's edges, in pixels. */
const EDGE = 4;
/** Arrow keys move the spectrum's mark this far (Shift: further), as a share of its side. */
const STEP = 1 / 72;
const BIG_STEP = 1 / 12;

/** A place on the spectrum: hue across (0 to 1), lightness down (0 white, 1 black). */
type Spot = { readonly x: number; readonly y: number };

function spotColor({ x, y }: Spot): string {
  return hslToHex(Math.min(x, 0.9999) * 360, 1, 1 - y);
}

/** Where `color` is on the spectrum; the default pastel is near the top at the note's hue. */
function spotOf(color: string | null, id: string): Spot {
  if (color === null) return { x: defaultHue(id) / 360, y: 0.2 };
  const { hue, lightness } = hexToHsl(color);
  return { x: hue / 360, y: 1 - lightness };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The note's colour in Details: a round swatch that opens, above it, a
 * spectrum (hue across, white to the colour to black down) and the nine
 * colours picked last. A click on the spectrum, or a drag let go, picks a
 * colour; from the keyboard the arrows move the mark and Enter picks. Escape,
 * a click elsewhere, scrolling or resizing closes it without picking.
 */
export function ColorPicker({ id, color, onPick }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const label = t("details.color");

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button color-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((shown) => !shown);
        }}
      >
        <span className="color-swatch" style={colorStyle(id, color)} />
      </button>
      {open && (
        <ColorPopover
          anchor={button}
          id={id}
          color={color}
          onPick={(picked) => {
            if (picked !== null) rememberColor(picked);
            onPick(picked);
            close(true);
          }}
          onClose={close}
        />
      )}
    </>
  );
}

function ColorPopover({
  anchor,
  id,
  color,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  id: string;
  color: string | null;
  onPick: (color: string | null) => void;
  onClose: (refocus: boolean) => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const spectrum = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot>(() => spotOf(color, id));
  const [recent] = useState(() => recentColors());
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  // Above the button, its right edge on the button's, inside the window;
  // below it when there is no room above.
  useLayoutEffect(() => {
    const element = popover.current;
    if (!element || !anchor.current) return;
    const at = anchor.current.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    const above = at.top - height - EDGE;
    const top =
      above >= EDGE ? above : Math.min(at.bottom + EDGE, window.innerHeight - height - EDGE);
    const left = Math.max(EDGE, Math.min(at.right - width, window.innerWidth - width - EDGE));
    element.style.top = `${String(Math.max(EDGE, top))}px`;
    element.style.left = `${String(left)}px`;
  }, [anchor]);

  useEffect(() => {
    spectrum.current?.focus({ preventScroll: true });
    const dismiss = () => {
      close.current(false);
    };
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // The swatch button toggles the popover itself.
      if (popover.current?.contains(target) || anchor.current?.contains(target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor]);

  function spotAt(event: PointerEvent<HTMLDivElement>): Spot {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / Math.max(1, box.width)),
      y: clamp((event.clientY - box.top) / Math.max(1, box.height)),
    };
  }

  function handleSpectrumKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, Spot> = {
      ArrowLeft: { x: (spot.x - step + 1) % 1, y: spot.y },
      ArrowRight: { x: (spot.x + step) % 1, y: spot.y },
      ArrowUp: { x: spot.x, y: clamp(spot.y - (event.shiftKey ? 0.2 : 0.05)) },
      ArrowDown: { x: spot.x, y: clamp(spot.y + (event.shiftKey ? 0.2 : 0.05)) },
    };
    const next = moves[event.key];
    if (next) {
      event.preventDefault();
      setSpot(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(spotColor(spot));
    }
  }

  const preview = spotColor(spot);
  const slots = Array.from({ length: RECENT_COLORS }, (_, index) => recent[index] ?? null);

  return createPortal(
    <div
      ref={popover}
      role="dialog"
      aria-label={t("details.color")}
      className="color-popover"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      }}
    >
      <div
        ref={spectrum}
        role="slider"
        tabIndex={0}
        className="color-spectrum"
        aria-label={t("details.colorSpectrum")}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(Math.min(spot.x, 0.9999) * 360)}
        aria-valuetext={preview}
        onKeyDown={handleSpectrumKey}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          setSpot(spotAt(event));
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          setSpot(spotAt(event));
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onPick(spotColor(spotAt(event)));
        }}
      >
        <span
          className="color-spectrum-mark"
          style={{
            left: `${String(spot.x * 100)}%`,
            top: `${String(spot.y * 100)}%`,
            background: preview,
          }}
        />
      </div>
      <div className="color-recent" role="group" aria-label={t("details.colorRecent")}>
        {slots.map((slot, index) =>
          slot === null ? (
            <span key={`empty-${String(index)}`} className="color-slot color-slot-empty" />
          ) : (
            <button
              key={slot}
              type="button"
              className="color-slot"
              style={{ background: slot }}
              aria-label={slot}
              title={slot}
              aria-pressed={slot === color}
              onClick={() => {
                onPick(slot);
              }}
            />
          ),
        )}
      </div>
      {color !== null && (
        <button
          type="button"
          className="color-default"
          onClick={() => {
            onPick(null);
          }}
        >
          <span className="color-swatch" style={colorStyle(id, null)} />
          {t("details.colorDefault")}
        </button>
      )}
    </div>,
    document.body,
  );
}
