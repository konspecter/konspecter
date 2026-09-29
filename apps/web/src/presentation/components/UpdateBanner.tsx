import { useEffect, useState } from "react";
import type { UpdateSource } from "../app/updates";

export function UpdateBanner({ updates }: { updates: UpdateSource }) {
  const [available, setAvailable] = useState(false);

  useEffect(
    () =>
      updates.subscribe(() => {
        setAvailable(true);
      }),
    [updates],
  );

  if (!available) return null;
  return (
    <div role="status" className="update-banner">
      <span>A new version of Konspecter is available.</span>
      <button type="button" className="button" onClick={updates.apply}>
        Reload
      </button>
      <button
        type="button"
        className="button"
        onClick={() => {
          setAvailable(false);
        }}
      >
        Later
      </button>
    </div>
  );
}
