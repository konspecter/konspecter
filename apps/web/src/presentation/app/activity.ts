/**
 * Whether the app is moving data right now (saving, syncing), for the
 * antenna indicator. Work reports itself with `begin()`; the state stays
 * active for `linger` ms after the last piece ends, so a 5 ms write still
 * shows as one calm pulse instead of a flicker. An external store for
 * useSyncExternalStore.
 */
export class Activity {
  readonly #listeners = new Set<() => void>();
  readonly #linger: number;
  #running = 0;
  #active = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor({ linger = 600 }: { linger?: number } = {}) {
    this.#linger = linger;
  }

  /** Marks work as started. Returns the function that marks it finished (once). */
  begin(): () => void {
    this.#running += 1;
    clearTimeout(this.#timer);
    this.#set(true);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#running -= 1;
      if (this.#running > 0) return;
      this.#timer = setTimeout(() => {
        this.#set(false);
      }, this.#linger);
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.#active;

  #set(active: boolean): void {
    if (active === this.#active) return;
    this.#active = active;
    for (const listener of this.#listeners) listener();
  }
}
