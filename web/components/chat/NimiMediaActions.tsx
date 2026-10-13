'use client'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch, apiUrl } from '@/lib/api'

type Action = {
  requestId: string
  type: string
  status: string
  reasonDetail?: string
  parameters: { prompt?: string }
  files?: { url: string; filename: string }[]
}

/** Recovery observes the original author action; it never submits new work. */
export default function NimiMediaActions({
  sessionId,
  running,
}: {
  sessionId: string | null
  running: boolean
}) {
  const { t } = useTranslation()
  const [actions, setActions] = useState<Action[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!sessionId) {
      setActions([])
      return
    }
    const response = await apiFetch(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/nimi-media`)
    )
    if (!response.ok) return
    const data = await response.json()
    setActions(data.actions)
  }, [sessionId])
  useEffect(() => {
    if (!running) void refresh().catch(() => {})
  }, [refresh, running])
  const recover = async (id: string, cancel = false) => {
    setBusy(id)
    setError('')
    try {
      const response = await apiFetch(
        apiUrl(
          `/api/sessions/${encodeURIComponent(sessionId || '')}/nimi-media/${encodeURIComponent(id)}?cancel=${cancel}`
        ),
        { method: 'POST' }
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || t('Media task could not be recovered.'))
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }
  if (running || !actions.length) return null
  return (
    <details className="mx-auto my-2 w-full max-w-[960px] px-6 text-sm">
      <summary className="cursor-pointer text-[var(--muted-foreground)]">
        {t('Media tasks and downloads')}
      </summary>
      <div className="mt-2 space-y-2">
        {actions
          .slice(-10)
          .reverse()
          .map(action => (
            <div key={action.requestId} className="rounded-lg border border-[var(--border)] p-3">
              <p className="line-clamp-2">{action.parameters.prompt}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {t(action.status)}
                {action.reasonDetail ? ` — ${action.reasonDetail}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                {action.status !== 'saved' && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void recover(action.requestId)}
                  >
                    {busy === action.requestId ? t('Loading...') : t('Check original task')}
                  </button>
                )}
                {!['saved', 'failed', 'canceled', 'timeout'].includes(action.status) && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void recover(action.requestId, true)}
                  >
                    {t('Cancel media task')}
                  </button>
                )}
                {action.files?.map(file => (
                  <a key={file.url} href={file.url} download={file.filename} className="underline">
                    {file.filename}
                  </a>
                ))}
              </div>
            </div>
          ))}
        {error && (
          <p role="alert" className="text-[var(--destructive)]">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}
