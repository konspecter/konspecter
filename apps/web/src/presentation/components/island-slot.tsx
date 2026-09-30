import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Where the open editor puts its tools on small screens: a place in the
 * island, after the search. The layout provides the element (null without
 * an island); editors render into it with `<InIsland>`.
 */
export const IslandSlot = createContext<HTMLElement | null>(null);

/** Renders `children` in the island, or nowhere without one. */
export function InIsland({ children }: { children: ReactNode }) {
  const slot = use(IslandSlot);
  return slot ? createPortal(children, slot) : null;
}
