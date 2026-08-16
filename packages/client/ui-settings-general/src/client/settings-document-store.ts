/** State owner for the optional local settings-document action. */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser state of the Host-owned settings document. */
export interface SettingsDocumentState {
  /** Metadata-loading phase; unavailable means the provider has no local document or the read failed. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Whether one native-open request is in flight. */
  opening: boolean
  /** Last metadata/native-open diagnostic; UI exposes only localized copy. */
  error: string | null
  /** Whether the in-browser document editor modal is open. */
  editorOpen: boolean
  /** The Host path of the document, for display inside the editor. */
  path: string | null
  /** Raw document text loaded into the editor. */
  content: string
  /** Whether one document-write request is in flight. */
  saving: boolean
  /** Last editor-save diagnostic; UI exposes only localized copy. */
  saveError: string | null
  /** Whether the Host can hand the path to a native opener (the editor offers it as a secondary action). */
  canOpen: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Loads local-document availability and runs the Host-owned open and edit operations. */
export class SettingsDocumentStore {
  /** uSES-safe state source shared by the registered header action. */
  readonly store: SnapshotStore<SettingsDocumentState> = createSnapshotStore({
    status: 'idle', opening: false, error: null,
    editorOpen: false, path: null, content: '', saving: false, saveError: null, canOpen: false,
  })

  private generation = 0

  /**
   * @param api - loopback settings wire face that reports, reads, writes, and opens the provider document.
   * @param canOpenPath - live Host capability: whether a native open can plausibly reach a desktop.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings'>,
    private readonly canOpenPath: () => boolean,
  ) {}

  /**
   * Load whether the current provider owns a local document.
   * @returns after the latest metadata response updates the store.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
      state.canOpen = this.canOpenPath()
    })
    try {
      const { result } = await this.api.settings.describe({})
      if (generation !== this.generation) return
      if (!result.ok) {
        this.store.update((state) => {
          state.status = 'unavailable'
          state.error = result.error.message
        })
        return
      }
      this.store.update((state) => {
        state.status = result.value.hasDocument ? 'ready' : 'unavailable'
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'unavailable'
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Open the loaded document once; concurrent gestures collapse behind the in-flight action.
   * @returns after the native-open request settles, or immediately when unavailable/already opening.
   */
  async open(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.status !== 'ready' || current.opening) return
    this.store.update((state) => {
      state.opening = true
      state.error = null
    })
    try {
      const response = await this.api.settings.openDocument({})
      if (!response.result.ok) throw new Error(response.result.error.message)
    } catch (error) {
      this.store.update((state) => { state.error = messageOf(error) })
    } finally {
      this.store.update((state) => { state.opening = false })
    }
  }

  /**
   * Load the raw document into the in-browser editor and show it. The read
   * happens every open, so the editor never shows stale bytes after an
   * external edit.
   * @returns after the read settles; a failed read keeps the editor closed.
   */
  async openEditor(): Promise<void> {
    if (this.store.getSnapshot().status !== 'ready') return
    this.store.update((state) => {
      state.editorOpen = true
      state.saveError = null
      state.content = ''
    })
    try {
      const { result } = await this.api.settings.documentRead({})
      if (!result.ok) throw new Error(result.error.message)
      this.store.update((state) => {
        state.path = result.value.path
        state.content = result.value.content
      })
    } catch (error) {
      this.store.update((state) => {
        state.editorOpen = false
        state.error = messageOf(error)
      })
    }
  }

  /** Dismiss the in-browser editor, discarding unsaved edits. */
  closeEditor(): void {
    this.store.update((state) => {
      state.editorOpen = false
      state.saveError = null
    })
  }

  /**
   * Replace the editor's staged document text with the user's edit.
   * @param content - the new staged document text.
   */
  edit(content: string): void {
    this.store.update((state) => { state.content = content })
  }

  /**
   * Replace the whole document with the editor's current text. The Host
   * validates the replacement; a rejected write keeps the editor open with
   * the diagnostic.
   * @returns after the write settles.
   */
  async saveEditor(): Promise<void> {
    const current = this.store.getSnapshot()
    if (!current.editorOpen || current.saving) return
    this.store.update((state) => {
      state.saving = true
      state.saveError = null
    })
    try {
      const { result } = await this.api.settings.documentWrite({ content: current.content })
      if (!result.ok) throw new Error(result.error.message)
      this.closeEditor()
    } catch (error) {
      this.store.update((state) => { state.saveError = messageOf(error) })
    } finally {
      this.store.update((state) => { state.saving = false })
    }
  }
}

/**
 * Refresh document availability after reconnect only when a surface has already requested it.
 * @param controller - optional loopback document state owner.
 */
export function refreshDocumentIfLoaded(controller: SettingsDocumentStore | undefined): void {
  if (controller === undefined || controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
