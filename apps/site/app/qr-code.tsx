import { encode } from "uqr";

/**
 * A QR code as one SVG path: dark modules on a light square, whatever the
 * theme, since not every scanner reads an inverted code. The quiet zone (four
 * modules) is part of the square. Rendered on the server, so it needs no script.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 4 });
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fdfdfc" />
      <path d={modulesPath(data)} fill="#1f2023" />
    </svg>
  );
}

/** Each row's runs of dark modules as rectangles of one path. */
export function modulesPath(data: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (row[x]) x++;
      parts.push(`M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`);
    }
  });
  return parts.join("");
}
