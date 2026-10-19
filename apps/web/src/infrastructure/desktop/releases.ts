/**
 * The desktop app has no service worker, so it asks GitHub for the latest
 * release instead. Drafts and pre-releases are never the latest.
 */
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/konspecter/konspecter/releases/latest";

/** A published release: its version (no "v") and its page on GitHub. */
export type Release = { readonly version: string; readonly url: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Reads GitHub's answer for a release; throws on anything else. */
export function parseRelease(value: unknown): Release {
  const { tag_name: tag, html_url: url } = (
    typeof value === "object" && value !== null ? value : {}
  ) as Record<string, unknown>;
  if (typeof tag !== "string" || typeof url !== "string") {
    throw new Error("GitHub returned an invalid release");
  }
  const version = tag.replace(/^v/, "");
  if (!VERSION.test(version)) throw new Error(`The release tag ${tag} is not a version`);
  if (!url.startsWith("https://github.com/")) {
    throw new Error(`The release page ${url} is not on GitHub`);
  }
  return { version, url };
}

/**
 * Whether `candidate` comes after `current` by semantic versioning: a release
 * is newer than its own pre-release (0.9.0 > 0.9.0-rc.1). Pre-releases of one
 * version compare as text.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = VERSION.exec(candidate);
  const b = VERSION.exec(current);
  if (!a || !b) return false;
  for (let part = 1; part <= 3; part++) {
    const difference = Number(a[part]) - Number(b[part]);
    if (difference !== 0) return difference > 0;
  }
  const [preA, preB] = [a[4], b[4]];
  if (preA === undefined) return preB !== undefined;
  return preB !== undefined && preA > preB;
}

/** The latest published release. */
export async function latestRelease(
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<Release> {
  const response = await fetchFn(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${String(response.status)} for the latest release`);
  }
  return parseRelease(await response.json());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks for a release newer than `current` `after` start, then `every` so
 * often, and calls `onNewer` once for each newer version. A failed check
 * (offline, rate limit) waits for the next one.
 */
export function watchReleases({
  current,
  onNewer,
  check = latestRelease,
  after = 10_000,
  every = DAY_MS,
}: {
  current: string;
  onNewer: (release: Release) => void;
  check?: () => Promise<Release>;
  after?: number;
  every?: number;
}): void {
  let newest = current;
  const run = async () => {
    try {
      const release = await check();
      if (!isNewer(release.version, newest)) return;
      newest = release.version;
      onNewer(release);
    } catch {
      // Offline or refused: the next check tries again.
    }
  };
  setTimeout(() => {
    void run();
    setInterval(() => void run(), every);
  }, after);
}
