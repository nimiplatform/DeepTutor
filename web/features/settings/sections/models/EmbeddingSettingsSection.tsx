"use client";

import { useTranslation } from "react-i18next";

import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";

export default function EmbeddingSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Embedding")}
        description={t(
          "Configure embedding model profiles. Used by retrieval and knowledge-base ingestion.",
        )}
      />
      <NimiModelSettings capability="text.embed" />
    </div>
  );
}
