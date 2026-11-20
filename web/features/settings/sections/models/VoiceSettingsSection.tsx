"use client";
import { useTranslation } from "react-i18next";
import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import NimiSpeechVoice from "@/components/settings/NimiSpeechVoice";
import { SettingsPageHeader } from "@/components/settings/shared";
import { VoicePlaybackPrefs } from "./VoicePlaybackPrefs";
export default function VoiceSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("settings.serviceConfig.voiceServices")}
        description={t(
          "Read assistant replies aloud and transcribe recordings using models configured in Nimi.",
        )}
      />
      <VoicePlaybackPrefs />
      <NimiModelSettings capability="audio.synthesize" />
      <NimiSpeechVoice />
    </div>
  );
}
