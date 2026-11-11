import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  label: string;
  /** Styles the item as destructive (Delete). */
  danger?: boolean;
  onSelect: () => void;
};

type ContextMenuProps = {
  /** Where it opens, in viewport pixels: the pointer, or the row from the keyboard. */
  x: number;
  y: number;
  /** The menu's accessible name: what it acts on. */
  label: string;
  items: readonly ContextMenuItem[];
  onClose: () => void;
};

/** Space kept between the menu and the window's edges, in pixels. */
const EDGE = 4;

/**
 * The app's own context menu, in place of the browser's. It opens at the
 * pointer, kept inside the window, with the focus on its first item: ↑/↓,
 * Home and End move between the items, Enter or a click chooses one. Escape,
 * Tab, a click elsewhere, scrolling or resizing closes it, and the focus goes
 * back where it was, unless the chosen item moved it on.
 */
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  // Inside the window: a menu opened near its right or bottom edge moves in.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${String(Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)))}px`;
    element.style.top = `${String(Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)))}px`;
  }, [x, y]);

  useEffect(() => {
    const previous = document.activeElement;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = () => {
      close.current();
    };
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      // The menu is gone: the focus was on it unless the chosen item moved it.
      const focus = document.activeElement;
      if ((focus === null || focus === document.body) && previous instanceof HTMLElement) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = entries[(at + 1) % entries.length];
        break;
      case "ArrowUp":
        next = entries[(at - 1 + entries.length) % entries.length];
        break;
      case "Home":
        next = entries[0];
        break;
      case "End":
        next = entries.at(-1);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    next?.focus();
  }

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="context-menu"
      style={{ left: x, top: y }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={item.danger ? "context-menu-item context-menu-danger" : "context-menu-item"}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
