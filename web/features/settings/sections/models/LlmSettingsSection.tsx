"use client";
import { useTranslation } from "react-i18next";
import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";
export default function LlmSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Language models")}
        description={t(
          "Manage language models and their context, capabilities, and connection tests.",
        )}
      />
      <NimiModelSettings capability="text.generate" />
    </div>
  );
}
