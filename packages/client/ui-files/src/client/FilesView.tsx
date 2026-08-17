/**
 * Workspace Files panel: browse the active session's workspace root, open
 * text files in a bounded viewer/editor, upload new files, and hand files
 * to the browser download manager. All data arrives through the injected
 * session-bound operations (contract.ts); the component owns only its own
 * navigation, selection, and edit state. The panel is workspace-scoped by
 * the host: every path is workspace-relative and containment-checked.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileContent, FilesEntry, FilesListing } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilesViewInjected } from './contract.ts'
import css from './FilesView.module.css'

/** One editor session: the open file and its bounded content. */
interface OpenFile {
  readonly path: string
  readonly content: FileContent
}

/** Human-readable byte size (files usually stay small; B/KB/MB suffices). */
function formatSize(size: number): string {
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Breadcrumb segments of a workspace-relative path (`''` = root). */
function crumbsOf(path: string): string[] {
  return path === '' ? [] : path.split('/')
}

/** Join a directory and a child name into one workspace-relative path. */
function joinPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

/** The crumb path for a segment index (`'src/main'` → `['src', 'src/main']`). */
function crumbPaths(segments: readonly string[]): string[] {
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly listing: FilesListing }
  | { readonly kind: 'error'; readonly message: string }

/**
 * The Files view body. Local state only: current directory, listing phase,
 * the open editor, and transient notices — everything else arrives via the
 * injected session-bound operations.
 */
export function FilesView({
  list, read, write, upload, download, t,
}: FilesViewInjected & PropsLocale<'files'>) {
  const [directory, setDirectory] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [listState, setListState] = useState<ListState>({ kind: 'loading' })
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)

  const crumbs = useMemo(() => crumbsOf(directory), [directory])
  const paths = useMemo(() => crumbPaths(crumbs), [crumbs])

  // Re-list on directory change; abort the in-flight scan when the panel
  // unmounts or navigates again (the effect cleanup fires on both).
  useEffect(() => {
    const controller = new AbortController()
    setListState({ kind: 'loading' })
    void list(directory, controller.signal).then(
      (listing) => { setListState({ kind: 'ready', listing }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setListState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { controller.abort() }
  }, [directory, refreshTick, list])

  const navigate = (path: string): void => {
    setOpen(null)
    setNotice(null)
    setDirectory(path)
  }

  const openEntry = async (entry: FilesEntry): Promise<void> => {
    if (entry.type === 'directory') {
      navigate(joinPath(directory, entry.name))
      return
    }
    if (entry.type !== 'file') {
      setNotice({ kind: 'error', text: t('panel.notText') })
      return
    }
    const controller = new AbortController()
    try {
      const content = await read(joinPath(directory, entry.name), controller.signal)
      setOpen({ path: joinPath(directory, entry.name), content })
      setDraft(content.content)
      setNotice(null)
    } catch (error: unknown) {
      /* v8 ignore next -- the openEntry controller is never aborted (no unmount wiring); the arm guards a future caller. */
      if (controller.signal.aborted) return
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const save = async (): Promise<void> => {
    /* v8 ignore next -- the Save button only renders with an open file and is disabled while saving; the arm guards a future caller. */
    if (open === null || saving) return
    setSaving(true)
    try {
      await write(open.path, draft)
      setNotice({ kind: 'info', text: t('panel.saved') })
      setOpen({ ...open, content: { ...open.content, content: draft } })
    } catch (error: unknown) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const onUploadSelected = async (file: File | undefined): Promise<void> => {
    if (file === undefined || uploading) return
    setUploading(true)
    try {
      const data = await file.arrayBuffer()
      await upload(joinPath(directory, file.name), bytesToBase64(new Uint8Array(data)))
      setNotice({ kind: 'info', text: t('panel.uploaded') })
      const controller = new AbortController()
      const listing = await list(directory, controller.signal)
      setListState({ kind: 'ready', listing })
    } catch (error: unknown) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setUploading(false)
      /* v8 ignore next -- the hidden input stays mounted for the panel's lifetime; the guard covers an unmounted ref. */
      if (uploadInput.current !== null) uploadInput.current.value = ''
    }
  }

  /** Copy a path to the clipboard; false when the host refused the write. */
  const copyPath = (text: string): Promise<boolean> => writeClipboard(text)

  const editable = open !== null && !open.content.truncated

  return (
    <div className={css.panel} role="region" aria-label={t('panel.aria')}>
      <div className={css.toolbar}>
        <div className={css.crumbs}>
          <button type="button" className={css.crumb} onClick={() => { navigate('') }}>
            {t('panel.root')}
          </button>
          {paths.map((path, index) => (
            <span key={path} className={css.crumbGroup}>
              <span className={css.separator}>/</span>
              <button type="button" className={css.crumb} onClick={() => { navigate(path) }}>
                {crumbs[index] as string}
              </button>
            </span>
          ))}
        </div>
        <button type="button" className={css.button} onClick={() => { setRefreshTick(tick => tick + 1) }}>
          {t('panel.refresh')}
        </button>
        <button type="button" className={css.button} disabled={uploading} onClick={() => uploadInput.current?.click()}>
          {t('panel.upload')}
        </button>
        <input
          ref={uploadInput}
          className={css.hiddenInput}
          type="file"
          onChange={(event) => { void onUploadSelected(event.target.files?.[0]) }}
        />
      </div>

      {notice !== null && (
        <div className={`${css.notice} ${notice.kind === 'error' ? css.noticeError : css.noticeInfo}`}>
          {notice.text}
        </div>
      )}

      {open !== null ? (
        <div className={css.editor}>
          <div className={css.editorHead}>
            <span className={css.editorTitle}>{open.path}</span>
            <button type="button" className={css.button} onClick={() => { download(open.path) }}>
              {t('panel.download')}
            </button>
            <button
              type="button"
              className={css.button}
              disabled={!editable || saving}
              onClick={() => { void save() }}
            >
              {t('panel.save')}
            </button>
            <button type="button" className={css.button} onClick={() => { setOpen(null) }}>
              {t('panel.close')}
            </button>
          </div>
          {open.content.truncated && <div className={`${css.notice} ${css.noticeInfo}`}>{t('panel.truncated')}</div>}
          <textarea
            className={css.textarea}
            value={draft}
            readOnly={!editable}
            onChange={(event) => { setDraft(event.target.value) }}
            spellCheck={false}
          />
        </div>
      ) : listState.kind === 'loading' ? (
        <div className={css.notice}>{t('panel.loading')}</div>
      ) : listState.kind === 'error' ? (
        <div className={`${css.notice} ${css.noticeError}`}>{listState.message}</div>
      ) : listState.listing.entries.length === 0 ? (
        <div className={css.notice}>{t('panel.empty')}</div>
      ) : (
        <div className={css.entries} role="list">
          {listState.listing.entries.map(entry => (
            <div
              key={entry.name}
              className={css.row}
              role="listitem"
              onClick={() => { void openEntry(entry) }}
            >
              <span className={css.rowName}>{entry.type === 'directory' ? `${entry.name}/` : entry.name}</span>
              {entry.type === 'file' && entry.size !== undefined && (
                <span className={`${css.rowMeta} ${css.size}`}>{formatSize(entry.size)}</span>
              )}
              {entry.type === 'file' && (
                <span className={css.rowAction}>
                  <button
                    type="button"
                    className={css.button}
                    onClick={(event) => {
                      event.stopPropagation()
                      download(joinPath(directory, entry.name))
                    }}
                  >
                    {t('panel.download')}
                  </button>
                  <button
                    type="button"
                    className={css.button}
                    onClick={(event) => {
                      event.stopPropagation()
                      void copyPath(joinPath(directory, entry.name)).then(
                        (accepted) => {
                          if (accepted) setNotice({ kind: 'info', text: t('panel.copied') })
                          else setNotice({ kind: 'error', text: t('panel.copyFailed') })
                        },
                      )
                    }}
                  >
                    {t('panel.copyPath')}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Base64-encode bytes without the browser's data: prefix (the host schema rejects it). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
