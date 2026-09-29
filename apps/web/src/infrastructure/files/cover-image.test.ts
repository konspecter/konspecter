import { coverDataUrl, CoverImageError } from "./cover-image";

// jsdom decodes and draws no images: stand in for the browser's parts.
function stubBitmap(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve({ width, height, close })),
  );
  return close;
}

function stubCanvas(encodes: readonly string[]) {
  const context = { drawImage: vi.fn(), fillRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback, type) => {
      // A browser that cannot encode a type falls back to PNG.
      const encoded = type !== undefined && encodes.includes(type) ? type : "image/png";
      callback(new Blob(["x"], { type: encoded }));
    });
  return { context, toBlob };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("coverDataUrl", () => {
  it("refuses a file that is not an image", async () => {
    const file = new File(["# hi"], "note.md", { type: "text/markdown" });

    await expect(coverDataUrl(file)).rejects.toBeInstanceOf(CoverImageError);
  });

  it("refuses an image the browser cannot decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("broken"))),
    );
    const file = new File(["nope"], "c.png", { type: "image/png" });

    await expect(coverDataUrl(file)).rejects.toBeInstanceOf(CoverImageError);
  });

  it("keeps a small image as it is", async () => {
    const close = stubBitmap(800, 400);
    const { toBlob } = stubCanvas(["image/webp"]);
    const file = new File([new Uint8Array([1, 2, 3])], "c.gif", { type: "image/gif" });

    await expect(coverDataUrl(file)).resolves.toBe("data:image/gif;base64,AQID");
    expect(toBlob).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("scales a large image down to 1600 pixels and encodes it as WebP", async () => {
    stubBitmap(4000, 3000);
    const { context } = stubCanvas(["image/webp"]);
    const file = new File(["big"], "c.png", { type: "image/png" });

    const dataUrl = await coverDataUrl(file);

    expect(dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
  });

  it("falls back to JPEG on white where WebP cannot be encoded", async () => {
    stubBitmap(3000, 1000);
    const { context } = stubCanvas(["image/jpeg"]);
    const file = new File(["big"], "c.png", { type: "image/png" });

    await expect(coverDataUrl(file)).resolves.toMatch(/^data:image\/jpeg;base64,/);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 533);
  });
});
