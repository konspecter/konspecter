import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Where the open editor puts its tools on small screens: a bar of their own
 * just above the island, over its Settings button; with the island's search
 * open, in one row with it across the screen, at its right edge. The layout provides the element (null
 * without an island); editors render into it with `<InIsland>`.
 */
export const IslandSlot = createContext<HTMLElement | null>(null);

/** Renders `children` above the island, or nowhere without one. */
export function InIsland({ children }: { children: ReactNode }) {
  const slot = use(IslandSlot);
  return slot ? createPortal(children, slot) : null;
}
