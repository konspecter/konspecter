import { ApiError, type ApiClient } from "../http/api-client";
import type { Scheduler } from "./sync-engine";

export type ChangeStreamEvents = {
  /** Something changed on the server: a sync cycle should run. */
  onChange: () => void;
  /** The stream is open (true) or down (false: poll meanwhile). */
  onConnected: (connected: boolean) => void;
};

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

/**
 * Listens to the server's change events (`GET /api/events`) and reports each
 * one, so another device's edit arrives within a moment instead of at the
 * next poll. The events carry no data; the sync cycle fetches the changes.
 *
 * After a failure it reconnects with backoff. It gives up for good when the
 * server has no event stream (404, an older server) or refuses the token
 * (401: the sync cycle reports that).
 */
export class ChangeStream {
  readonly #client: ApiClient;
  readonly #events: ChangeStreamEvents;
  readonly #scheduler: Scheduler;
  readonly #random: () => number;
  #controller: AbortController | null = null;
  #timer: unknown = null;
  #failures = 0;

  constructor(
    client: ApiClient,
    events: ChangeStreamEvents,
    options: { scheduler: Scheduler; random: () => number },
  ) {
    this.#client = client;
    this.#events = events;
    this.#scheduler = options.scheduler;
    this.#random = options.random;
  }

  start(): void {
    if (this.#controller || this.#timer !== null) return;
    const controller = new AbortController();
    this.#controller = controller;
    void this.#run(controller);
  }

  stop(): void {
    this.#controller?.abort();
    this.#controller = null;
    if (this.#timer !== null) this.#scheduler.clear(this.#timer);
    this.#timer = null;
  }

  async #run(controller: AbortController): Promise<void> {
    let retry = true;
    try {
      const body = await this.#client.events(controller.signal);
      this.#failures = 0;
      this.#events.onConnected(true);
      await readEvents(body, (name) => {
        if (name === "changes") this.#events.onChange();
      });
    } catch (error) {
      retry = !(error instanceof ApiError && (error.status === 404 || error.status === 401));
    }
    if (controller.signal.aborted) return;
    this.#controller = null;
    this.#events.onConnected(false);
    if (!retry) return;
    this.#failures += 1;
    this.#timer = this.#scheduler.set(() => {
      this.#timer = null;
      this.start();
    }, this.#retryDelay());
  }

  /** About 1 s, 2 s, 4 s … up to a minute, with jitter. */
  #retryDelay(): number {
    const base = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (this.#failures - 1));
    return Math.round(base * (0.75 + this.#random() * 0.5));
  }
}

/**
 * Reads a Server-Sent Events stream until it ends, calling `onEvent` with
 * each event's name ("message" when it has none). Comments (heartbeats) and
 * the data are ignored.
 */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (name: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let name: string | null = null;
      let data = false;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data = true;
      }
      if (name !== null || data) onEvent(name ?? "message");
    }
  }
}
