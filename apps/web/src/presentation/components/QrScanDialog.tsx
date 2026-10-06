import { CloseIcon } from "@konspecter/ui/icons";
import { useEffect, useRef, useState } from "react";
import { parseConnectLink, type ConnectLink } from "../../domain/sync/connect-link";
import { cameraDenied, scanQrCodes } from "../../infrastructure/camera/qr-scanner";
import { t } from "../i18n/i18n";

/**
 * The camera, looking for the QR code the account site shows to connect an
 * app. The first connect link it sees goes to `onLink`; the parent then
 * connects (`connecting`) and closes the dialog, or shows why not (`error`),
 * and "Scan again" (`onRetry`, which clears the error) looks once more.
 * Closing turns the camera off.
 */
export function QrScanDialog({
  onLink,
  onRetry,
  onClose,
  connecting,
  error,
}: {
  onLink: (link: ConnectLink) => void;
  onRetry: () => void;
  onClose: () => void;
  connecting: boolean;
  error: string | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [problem, setProblem] = useState<"denied" | "unavailable" | null>(null);
  const [otherCode, setOtherCode] = useState(false);
  const latestOnLink = useRef(onLink);
  useEffect(() => {
    latestOnLink.current = onLink;
  });

  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const scanning = !connecting && error === null;
  useEffect(() => {
    const element = video.current;
    if (!scanning || !element) return;
    const controller = new AbortController();
    scanQrCodes(
      element,
      (text) => {
        const link = parseConnectLink(text);
        if (!link) {
          setOtherCode(true);
          return false;
        }
        latestOnLink.current(link);
        return true;
      },
      controller.signal,
    ).catch((scanError: unknown) => {
      if (!controller.signal.aborted)
        setProblem(cameraDenied(scanError) ? "denied" : "unavailable");
    });
    return () => {
      controller.abort();
    };
  }, [scanning]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        className="dialog scan-dialog"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="dialog-header">
          <h2 id="scan-title">{t("sync.scanTitle")}</h2>
          <button
            ref={close}
            type="button"
            className="icon-button"
            aria-label={t("app.close")}
            title={t("app.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        {problem === null && (
          <video ref={video} className="scan-video" muted playsInline aria-hidden="true" />
        )}
        <p className="setting-hint" role="status">
          {problem === "denied"
            ? t("sync.cameraDenied")
            : problem === "unavailable"
              ? t("sync.cameraUnavailable")
              : connecting
                ? t("sync.connecting")
                : otherCode
                  ? t("sync.scanOther")
                  : t("sync.scanHint")}
        </p>
        {error !== null && (
          <>
            <p role="alert" className="inline-error">
              {error}
            </p>
            <div className="actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setOtherCode(false);
                  onRetry();
                }}
              >
                {t("sync.scanAgain")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
