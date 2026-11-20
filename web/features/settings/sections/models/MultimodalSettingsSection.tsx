"use client";
import { useTranslation } from "react-i18next";
import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";
export default function MultimodalSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Multimodal generation")}
        description={t(
          "Choose the Nimi image and video models used by the chat generation tools.",
        )}
      />
      <NimiModelSettings capability="image.generate" />
    </div>
  );
}
