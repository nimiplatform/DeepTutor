"use client";

import { useTranslation } from "react-i18next";

import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";

export default function SttSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Speech-to-Text")}
        description={t(
          "Transcribe microphone recordings with the speech model selected in Nimi.",
        )}
      />
      <NimiModelSettings capability="audio.transcribe" />
    </div>
  );
}
