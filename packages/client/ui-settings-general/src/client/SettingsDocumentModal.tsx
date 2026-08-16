/** In-browser editor for the Host-owned settings document. */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { SettingsDocumentState, SettingsDocumentStore } from './settings-document-store.ts'
import css from './SettingsDocumentModal.module.css'

/** Registrant-owned dependencies of {@link SettingsDocumentModal}. */
export interface SettingsDocumentModalInjected {
  /** Provider metadata and editor state owner. */
  controller: SettingsDocumentStore
  /** Bound selector hook for the controller snapshot. */
  useSnapshot: SnapshotSelectorHook<SettingsDocumentState>
}

/** Header-action owner share, localized copy, and the registrant's state face. */
export type SettingsDocumentModalProps =
  PropsLocale<'settings'> & SettingsDocumentModalInjected

/**
 * Render the in-browser document editor over the settings chrome.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the editor overlay, or null while closed.
 */
export function SettingsDocumentModal({ controller, useSnapshot, t }: SettingsDocumentModalProps): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  if (!state.editorOpen) return null

  return (
    <div className={css.overlay} role="presentation">
      <div
        className={css.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-document-title"
      >
        <header className={css.header}>
          <h2 id="settings-document-title" className={css.title}>{t('document.title')}</h2>
          <p className={css.path} title={state.path ?? undefined}>{state.path}</p>
        </header>
        <textarea
          ref={textareaRef}
          className={css.editor}
          spellCheck={false}
          aria-label={t('document.editorLabel')}
          value={state.content}
          onChange={(event) => { controller.edit(event.target.value) }}
        />
        <footer className={css.footer}>
          {state.saveError === null
            ? null
            : <span className={css.error} role="alert">{t('document.saveError')}: {state.saveError}</span>}
          <div className={css.actions}>
            {state.canOpen && (
              <Button
                variant="ghost"
                size="sm"
                disabled={state.opening}
                onClick={() => { void controller.open() }}
              >
                {t('openDocument')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { controller.closeEditor() }}>
              {t('document.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={state.saving}
              onClick={() => { void controller.saveEditor() }}
            >
              {t('document.save')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
