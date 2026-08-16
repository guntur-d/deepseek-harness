// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent drops the label in the rail state', () => {
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  const readySettings = (overrides: Record<string, unknown> = {}) => ({
    describe: vi.fn(() => Promise.resolve({
      rpcId: 'document-action' as never,
      result: {
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [] },
      },
    })),
    openDocument: vi.fn(),
    documentRead: vi.fn(() => Promise.resolve({
      rpcId: 'document-read' as never,
      result: { ok: true as const, value: { path: '/home/test/settings.yaml', content: '# hello\n' } },
    })),
    documentWrite: vi.fn(),
    ...overrides,
  })

  function mountAction(controller: SettingsDocumentStore) {
    return render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
  }

  it('appears only for a file-backed provider and opens the in-browser editor', async () => {
    const settings = readySettings()
    const controller = new SettingsDocumentStore({ settings } as never, () => true)
    mountAction(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    await waitFor(() => { expect(settings.documentRead).toHaveBeenCalledWith({}) })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Configuration file content')).toBeTruthy()
    expect(within(dialog).getByText('/home/test/settings.yaml')).toBeTruthy()
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Configuration file content').value).toBe('# hello\n')
  })

  it('stays absent without a document and retries availability after remount', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'document-action-absent' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } },
      })
      .mockResolvedValueOnce({
        rpcId: 'document-action-ready' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } },
      })
    const controller = new SettingsDocumentStore({
      settings: { describe, openDocument: vi.fn(), documentRead: vi.fn(), documentWrite: vi.fn() },
    } as never, () => false)
    const first = mountAction(controller)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    mountAction(controller)
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('offers the native open inside the editor only when the Host can reach a desktop', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      rpcId: 'document-open-failed' as never,
      result: { ok: false as const, error: { code: 'internal' as const, message: 'xdg-open missing', details: {} } },
    }))
    const controller = new SettingsDocumentStore({
      settings: readySettings({ openDocument }),
    } as never, () => true)
    mountAction(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open configuration file' }))
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith({}) })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
  })

  it('hides the native-open affordance when the Host cannot open natively', async () => {
    const openDocument = vi.fn()
    const controller = new SettingsDocumentStore({
      settings: readySettings({ openDocument }),
    } as never, () => false)
    mountAction(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('saves the edited document through the Host and closes the editor', async () => {
    const documentWrite = vi.fn(() => Promise.resolve({
      rpcId: 'document-write' as never,
      result: { ok: true as const, value: { written: true as const } },
    }))
    const controller = new SettingsDocumentStore({
      settings: readySettings({ documentWrite }),
    } as never, () => false)
    mountAction(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Configuration file content'), { target: { value: '# edited\n' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(documentWrite).toHaveBeenCalledWith({ content: '# edited\n' }) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('keeps the editor open and reports a rejected write', async () => {
    const documentWrite = vi.fn(() => Promise.resolve({
      rpcId: 'document-write' as never,
      result: { ok: false as const, error: { code: 'internal' as const, message: 'invalid document', details: {} } },
    }))
    const controller = new SettingsDocumentStore({
      settings: readySettings({ documentWrite }),
    } as never, () => false)
    mountAction(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(within(dialog).getByRole('alert').textContent).toContain('invalid document') })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('cancel discards staged edits', async () => {
    const documentWrite = vi.fn()
    const controller = new SettingsDocumentStore({
      settings: readySettings({ documentWrite }),
    } as never, () => false)
    mountAction(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Configuration file content'), { target: { value: '# edited\n' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(documentWrite).not.toHaveBeenCalled()
  })
})
