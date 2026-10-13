"use client";

import { useTranslation } from "react-i18next";

import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";

export default function ConnectionsSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Connections")}
        description={t(
          "Text, retrieval, speech, image and video models are managed by Nimi for this app. Configure search credentials in Search settings.",
        )}
      />
      <NimiModelSettings />
    </div>
  );
}
