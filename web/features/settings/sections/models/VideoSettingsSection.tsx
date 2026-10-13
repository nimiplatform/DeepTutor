"use client";

import { useTranslation } from "react-i18next";

import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";

export default function VideoGenSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Video Generation")}
        description={t(
          "Choose the Nimi video model used by the chat video-generation tool. Completed videos are saved in the conversation workspace.",
        )}
      />
      <NimiModelSettings capability="video.generate" />
    </div>
  );
}
