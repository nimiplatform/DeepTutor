"use client";
import { useTranslation } from "react-i18next";
import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";
export default function ImageSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Multimodal generation")}
        description={t(
          "Choose the Nimi image model used by the chat image-generation tool.",
        )}
      />
      <NimiModelSettings capability="image.generate" />
    </div>
  );
}
