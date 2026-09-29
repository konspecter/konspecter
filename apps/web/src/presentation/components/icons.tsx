import type { ReactNode } from "react";

/** Line icons drawn for Konspecter: 24×24, stroked in the current text colour. */
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function SidebarIcon() {
  return (
    <Icon>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </Icon>
  );
}

export function GearIcon() {
  return (
    <Icon>
      <path d="M18.60 9.67L21.02 10.17L21.02 13.83L18.60 14.33L18.32 15.02L19.67 17.08L17.08 19.67L15.02 18.32L14.33 18.60L13.83 21.02L10.17 21.02L9.67 18.60L8.98 18.32L6.92 19.67L4.33 17.08L5.68 15.02L5.40 14.33L2.98 13.83L2.98 10.17L5.40 9.67L5.68 8.98L4.33 6.92L6.92 4.33L8.98 5.68L9.67 5.40L10.17 2.98L13.83 2.98L14.33 5.40L15.02 5.68L17.08 4.33L19.67 6.92L18.32 8.98Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** A blank page with a pencil. */
export function NewNoteIcon() {
  return (
    <Icon>
      <path d="M12.5 3.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6.5" />
      <path d="M17.6 3.4a1.9 1.9 0 0 1 2.7 2.7l-7.4 7.4-3.4.8.8-3.4z" />
    </Icon>
  );
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z" />
    </Icon>
  );
}

export function ChevronIcon() {
  return (
    <Icon className="icon-chevron">
      <path d="M9.5 6.5l5.5 5.5-5.5 5.5" />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </Icon>
  );
}

/** A mast with waves on both sides; the waves animate while data moves (CSS). */
export function AntennaIcon() {
  return (
    <Icon className="icon-antenna">
      <circle cx="12" cy="9" r="1.5" />
      <path d="M12 10.5L9.5 20.5M12 10.5l2.5 10M10.4 16.8h3.2" />
      <path className="wave wave-near" d="M9.5 6.5a3.5 3.5 0 0 0 0 5M14.5 6.5a3.5 3.5 0 0 1 0 5" />
      <path className="wave wave-far" d="M7.8 4.8a6 6 0 0 0 0 8.4M16.2 4.8a6 6 0 0 1 0 8.4" />
    </Icon>
  );
}
