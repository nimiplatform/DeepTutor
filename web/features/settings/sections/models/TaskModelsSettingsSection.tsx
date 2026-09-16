"use client";

import { useTranslation } from "react-i18next";

import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import { SettingsPageHeader } from "@/components/settings/shared";

export default function TaskModelsSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("Task models")}
        description={t(
          "Titles and suggested questions use the current tutoring model.",
        )}
      />
      <NimiModelSettings />
    </div>
  );
}
