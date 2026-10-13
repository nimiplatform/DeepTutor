"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNimiLocalAppClient } from "@/lib/nimi-client";
import { apiFetch, apiUrl } from "@/lib/api";

export default function NimiSpeechVoice() {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<readonly { voiceId: string; name: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [options, response] = await Promise.all([
        getNimiLocalAppClient().aiConfig.listOptions({ kind: "preset-voices" }),
        apiFetch(apiUrl("/api/settings")),
      ]);
      if (options.kind !== "preset-voices" || !response.ok) throw new Error(t("Voices could not be loaded."));
      const settings = await response.json();
      setVoices(options.options); setSelected(settings.ui.nimi_speech_voice || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [t]);
  useEffect(() => {
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener("deeptutor:nimi-models-changed", changed);
    return () => window.removeEventListener("deeptutor:nimi-models-changed", changed);
  }, [refresh]);
  const save = async (voice_id: string) => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(apiUrl("/api/settings/nimi-speech-voice"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice_id }) });
      if (!response.ok) throw new Error(t("The voice choice could not be saved."));
      setSelected(voice_id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <label className="block text-sm">{t("Read-aloud voice")}
      <select aria-label={t("Read-aloud voice")} disabled={busy} value={voices.some(v => v.voiceId === selected) ? selected : ""} onChange={event => void save(event.target.value)} className="mt-2 block w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2">
        <option value="">{t("Choose a voice")}</option>
        {voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}</option>)}
      </select>
    </label>
    <button type="button" disabled={busy} onClick={() => void refresh()} className="text-xs underline">{t("Refresh voices")}</button>
    {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
  </div>;
}
