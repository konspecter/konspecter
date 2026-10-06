/**
 * Reading QR codes with the device's camera (the back one, if there is a
 * choice): frames are drawn onto a canvas a few times a second and decoded
 * by jsQR, which loads only when a scan starts.
 */

/** How often a frame is decoded, and how large it is drawn for it. */
const SCAN_EVERY_MS = 150;
const MAX_SIDE = 720;

/** Whether this browser can show the camera to a page at all. */
export function cameraAvailable(): boolean {
  // mediaDevices is missing outside secure contexts (plain http).
  return typeof navigator !== "undefined" && "mediaDevices" in navigator;
}

/** The camera may not be used: the person or the system said no. */
export function cameraDenied(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

/**
 * Shows the camera in `video` and passes the text of every QR code it sees
 * to `onCode`, until `onCode` returns true or `signal` aborts; the camera is
 * then turned off. Rejects when the camera cannot be started.
 */
export async function scanQrCodes(
  video: HTMLVideoElement,
  onCode: (text: string) => boolean,
  signal: AbortSignal,
): Promise<void> {
  const [stream, { default: jsQR }] = await Promise.all([
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    }),
    import("jsqr"),
  ]);
  const stop = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  if (signal.aborted) {
    stop();
    return;
  }
  signal.addEventListener("abort", stop, { once: true });
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    stop();
    throw new Error("No canvas to read the camera's frames");
  }
  await new Promise<void>((resolve) => {
    let last = 0;
    const frame = (time: number) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      if (time - last >= SCAN_EVERY_MS && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        last = time;
        const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight, 1));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: "attemptBoth",
        });
        if (found && onCode(found.data)) {
          stop();
          resolve();
          return;
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
