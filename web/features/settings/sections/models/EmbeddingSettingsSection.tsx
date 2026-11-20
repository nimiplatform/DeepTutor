"use client";
import { useTranslation } from "react-i18next";
import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";
export default function EmbeddingSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Embedding models")}
        description={t(
          "Manage embedding models for retrieval and knowledge bases.",
        )}
      />
      <NimiModelSettings capability="text.embed" />
    </div>
  );
}
