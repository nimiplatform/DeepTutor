"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NimiThemeProvider, TooltipProvider } from "@nimiplatform/kit/ui";
import { ModelConfigAIConfigSurface } from "@nimiplatform/kit/features/model-config";
import type { NimiAIConfigSnapshot } from "@nimiplatform/sdk/ai";
import { createNimiClientId } from "@nimiplatform/sdk/types";
import { openDesktopIntent } from "@nimiplatform/kit/shell/renderer/bridge";
import { DEEPTUTOR_APP_ID, getNimiLocalAppClient, readNimiModelConfiguration } from "@/lib/nimi-client";
import Modal from "@/components/common/Modal";

export function NimiModelSettings({ capability = "text.generate" }: { capability?: string }) {
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await readNimiModelConfiguration());
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return (
    <NimiThemeProvider accentPack="nimi-accent"><TooltipProvider>
      <div className="nimi-model-settings">
        <ModelConfigAIConfigSurface
          context={{ owner: "app-ai-config", appId: DEEPTUTOR_APP_ID }}
          capabilityContracts={["text.generate", "text.embed", "audio.synthesize", "audio.transcribe", "image.generate", "video.generate"]}
          initialCapabilityContract={capability}
          capabilities={snapshot?.config ? snapshot.config.capabilities as never : snapshot ? null : undefined}
          revision={snapshot?.revision}
          effectiveSelections={snapshot?.effectiveSelections}
          listOptions={(query) => getNimiLocalAppClient().aiConfig.listOptions(query)}
          loading={loading && !snapshot} loadError={error}
          onRetry={() => { void refresh(); }}
          onOpenOwnerConfiguration={() => {
            void openDesktopIntent({ requestId: createNimiClientId("desktop-open"),
              intent: { kind: "open-apps", appId: DEEPTUTOR_APP_ID, section: "ai-models" } });
          }}
          onOverwrite={async (input) => {
            const result = await getNimiLocalAppClient().aiConfig.overwrite(input);
            setSnapshot({ config: result.config, revision: result.revision, effectiveSelections: [] });
            if (result.outcome === "committed") void refresh();
            return result;
          }}
        />
      </div>
    </TooltipProvider></NimiThemeProvider>
  );
}

export function NimiModelButton() {
  const [open, setOpen] = useState(false);
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">
      {chinese ? "Nimi 模型" : "Nimi models"}
    </button>
    <Modal isOpen={open} onClose={() => setOpen(false)} width="lg" title={chinese ? "学习使用的 AI 模型" : "Models for learning"}>
      <div className="p-5">
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">{chinese ? "DeepTutor 的学习任务共用这里的模型配置。修改向量模型后，请重新建立资料索引。" : "Learning tasks share this App configuration. Re-index your materials after changing the embedding model."}</p>
        {open && <NimiModelSettings />}
      </div>
    </Modal>
  </>;
}
