"use client";
import { useTranslation } from "react-i18next";
import { NimiModelSettings } from "@/components/settings/NimiModelSettings";
import NimiSpeechVoice from "@/components/settings/NimiSpeechVoice";
import { SettingsPageHeader } from "@/components/settings/shared";
import { VoicePlaybackPrefs } from "./VoicePlaybackPrefs";
export default function TtsSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <SettingsPageHeader
        title={t("settings.serviceConfig.voiceServices")}
        description={t(
          "Read assistant replies aloud from the chat speaker button. Choose the voice model in Nimi.",
        )}
      />
      <NimiModelSettings capability="audio.synthesize" />
      <NimiSpeechVoice />
      <VoicePlaybackPrefs />
    </div>
  );
}
