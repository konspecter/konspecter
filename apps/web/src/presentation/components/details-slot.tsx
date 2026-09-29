import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Where a page puts its details: the footer of the sidebar. The layout
 * provides the element; pages render into it with `<Details>`.
 */
export const DetailsSlot = createContext<HTMLElement | null>(null);

/** Renders `children` in the sidebar's details area, or nowhere without one. */
export function Details({ children }: { children: ReactNode }) {
  const slot = use(DetailsSlot);
  return slot ? createPortal(children, slot) : null;
}
