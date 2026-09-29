import { readEvents } from "./change-stream";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readEvents", () => {
  it("reports each event's name, across chunk boundaries and line endings", async () => {
    const names: string[] = [];
    await readEvents(
      streamOf([
        "event: chan",
        "ges\ndata: {}\n",
        "\n: ping\n\nevent: changes\r\ndata: {}\r\n\r\n",
      ]),
      (name) => names.push(name),
    );
    expect(names).toEqual(["changes", "changes"]);
  });

  it("ignores heartbeats and names unnamed events 'message'", async () => {
    const names: string[] = [];
    await readEvents(streamOf([": ping\n\n", "data: x\n\n", "event: changes\n"]), (name) =>
      names.push(name),
    );
    expect(names).toEqual(["message"]); // The unfinished last event is not reported.
  });
});
