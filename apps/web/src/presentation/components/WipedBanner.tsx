import { useState } from "react";
import { t } from "../i18n/i18n";
import { Banner } from "./Banner";

/** Says, once after the restart, that the device was disconnected and wiped from the site. */
export function WipedBanner() {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <Banner
      onClose={() => {
        setShown(false);
      }}
    >
      <span>{t("app.wiped")}</span>
    </Banner>
  );
}
