"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/common/Modal";
import { readNimiModelConfiguration } from "@/lib/nimi-client";

type Result =
  | { ready: true }
  | { ready: false; message: string; reasonCode?: string; actionHint?: string };

export default function NimiConnectionControl({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  const check = async () => {
    const current = ++request.current;
    setOpen(true);
    setChecking(true);
    setResult(null);
    try {
      await readNimiModelConfiguration();
      if (current === request.current) setResult({ ready: true });
    } catch (cause) {
      if (current !== request.current) return;
      const error = cause as {
        message?: unknown;
        reasonCode?: unknown;
        actionHint?: unknown;
      } | null;
      setResult({
        ready: false,
        message:
          typeof error?.message === "string"
            ? error.message
            : t("Nimi connection unavailable"),
        reasonCode:
          typeof error?.reasonCode === "string" ? error.reasonCode : undefined,
        actionHint:
          typeof error?.actionHint === "string" ? error.actionHint : undefined,
      });
    } finally {
      if (current === request.current) setChecking(false);
    }
  };
  const close = () => {
    request.current += 1;
    setChecking(false);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("Reconnect Nimi")}
        title={collapsed ? t("Reconnect Nimi") : undefined}
        onClick={() => void check()}
        disabled={checking}
        className={`flex w-full items-center rounded-lg py-2 text-[12px] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/55 hover:text-[var(--foreground)] disabled:opacity-60 ${collapsed ? "justify-center" : "gap-2.5 px-3"}`}
      >
        <PlugZap size={16} aria-hidden />
        {!collapsed && t("Reconnect Nimi")}
      </button>
      <Modal
        isOpen={open}
        onClose={close}
        width="md"
        title={t("Reconnect Nimi")}
      >
        <div className="space-y-4 p-5">
          <p className="text-sm text-[var(--muted-foreground)]">
            {t(
              "Check the AI connection without changing models. Your documents remain available.",
            )}
          </p>
          <div role="status" aria-live="polite" className="text-sm">
            {checking ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="animate-spin" size={16} />
                {t("Checking Nimi connection…")}
              </span>
            ) : result?.ready ? (
              t(
                "Connection check passed. You can send your request again; earlier tasks have not been replayed.",
              )
            ) : result ? (
              <div className="space-y-2">
                <p>{result.message}</p>
                {result.reasonCode && (
                  <code className="block text-xs">{result.reasonCode}</code>
                )}
                {result.actionHint && (
                  <code className="block break-all text-xs">
                    {result.actionHint}
                  </code>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            {!checking && result && !result.ready && (
              <button
                type="button"
                onClick={() => void check()}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                {t("Try again")}
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {t("Close")}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
