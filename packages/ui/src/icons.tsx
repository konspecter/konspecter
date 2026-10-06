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

/** A bulleted list: every conspect. */
export function ListIcon() {
  return (
    <Icon>
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
      <circle cx="5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
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

/** A letter T: the text editor, formatted as it reads. */
export function TextIcon() {
  return (
    <Icon>
      <path d="M5.5 7V5.5h13V7M12 5.5v13M9.5 18.5h5" />
    </Icon>
  );
}

/** The Markdown mark, M and a down arrow in a frame: the Markdown source editor. */
export function MarkdownIcon() {
  return (
    <Icon>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M6 15V9l2.5 3L11 9v6M16.5 9v6M14.3 12.8l2.2 2.2 2.2-2.2" />
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

/** A cross: close a dialog. */
export function CloseIcon() {
  return (
    <Icon>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

/** A closed folder, lightly filled: a tag in the tag tree. */
export function FolderIcon() {
  return (
    <Icon className="icon-folder">
      <path
        fill="currentColor"
        fillOpacity="0.16"
        d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5z"
      />
    </Icon>
  );
}

/** An open folder: an expanded tag. */
export function FolderOpenIcon() {
  return (
    <Icon className="icon-folder">
      <path d="M3.5 18V7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h6.5a1.5 1.5 0 0 1 1.5 1.5v1.5" />
      <path
        fill="currentColor"
        fillOpacity="0.16"
        d="M3.5 18l2.6-6.3a1 1 0 0 1 .93-.62H20.7a.8.8 0 0 1 .74 1.1L19 18.5a.8.8 0 0 1-.74.5H4.3a.8.8 0 0 1-.8-1z"
      />
    </Icon>
  );
}

/** A page with a folded corner: a note in the tag tree. */
export function DocumentIcon() {
  return (
    <Icon className="icon-document">
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M9 13h6M9 16.5h4" />
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

/** The antenna without waves, crossed out with an X: no connection. */
export function AntennaOffIcon() {
  return (
    <Icon className="icon-antenna">
      <circle cx="12" cy="9" r="1.5" />
      <path d="M12 10.5L9.5 20.5M12 10.5l2.5 10M10.4 16.8h3.2" />
      <path d="M5 5l14 14M19 5L5 19" />
    </Icon>
  );
}

/** A picture frame with a text line: the title and cover fields. */
export function TitleCoverIcon() {
  return (
    <Icon>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 15l4.5-4.5 3.5 3.5 2.5-2.5 6.5 6.5M7.5 8h6" />
    </Icon>
  );
}

/** An arrow into a tray: save a copy of the note. */
export function DownloadIcon() {
  return (
    <Icon>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 16.5v1.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5" />
    </Icon>
  );
}

/** A box with an arrow leaving it: open in another app. */
export function ExternalIcon() {
  return (
    <Icon>
      <path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 14v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" />
    </Icon>
  );
}

/** A folder with a magnifier: show the file in the file manager. */
export function RevealIcon() {
  return (
    <Icon>
      <path d="M20.5 11V9.5A1.5 1.5 0 0 0 19 8h-8l-2-2.5H5A1.5 1.5 0 0 0 3.5 7v10.5A1.5 1.5 0 0 0 5 19h5.5" />
      <circle cx="16.5" cy="15.5" r="3" />
      <path d="M18.7 17.7l2 2" />
    </Icon>
  );
}

/** A bin: delete. */
export function TrashIcon() {
  return (
    <Icon>
      <path d="M4.5 7h15M10 4.5h4M6.5 7l.9 11.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7M10.5 10.5v6M13.5 10.5v6" />
    </Icon>
  );
}

/** A tick in a circle: done. Each stroke has a path length of 1, so CSS can draw it in. */
export function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className ? { className } : {})}>
      <circle className="check-circle" cx="12" cy="12" r="9" pathLength="1" />
      <path className="check-tick" d="M8 12.3l2.7 2.7L16 9.5" pathLength="1" />
    </Icon>
  );
}

/** A globe: the language. */
export function GlobeIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z" />
    </Icon>
  );
}
