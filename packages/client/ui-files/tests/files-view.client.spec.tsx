// @vitest-environment jsdom
/**
 * FilesView behavior with driven props: listing renders and navigates,
 * opening a file shows the bounded editor, save/upload/download call the
 * injected session-bound operations, truncated content disables editing,
 * and failures surface as notices. The locale seat feeds the zh dictionary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileContent, FilesEntry, FilesListing } from '@deepseek-ai/dsh-client-connection/client'
import { FilesView } from '../src/client/FilesView.tsx'
import type { FilesViewInjected } from '../src/client/contract.ts'
import { zh, type FilesKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: FilesKey): string => zh[key]

/** A scripted injected face: each operation is a vi.fn the case programs. */
function face(overrides: Partial<FilesViewInjected> = {}): FilesViewInjected & { list: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(async () => ({ path: '', entries: [], truncated: false })),
    read: vi.fn(async () => ({ content: '', size: 0, truncated: false })),
    write: vi.fn(async () => ({ operation: 'create' as const, version: 'v1', bytes: 0 })),
    upload: vi.fn(async () => ({ operation: 'create' as const, version: 'v1', bytes: 0 })),
    download: vi.fn(),
    ...overrides,
  }
}

function entry(name: string, type: FilesEntry['type'], size?: number): FilesEntry {
  return { name, type, ...size === undefined ? {} : { size } }
}

function listing(entries: readonly FilesEntry[], path = ''): FilesListing {
  return { path, entries: [...entries], truncated: false }
}

describe('FilesView listing', () => {
  it('renders the workspace root entries with names and sizes', async () => {
    const f = face({
      list: vi.fn(async () => listing([
        entry('README.md', 'file', 5),
        entry('src', 'directory'),
      ])),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('README.md')
    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('5 B')).toBeTruthy()
    expect(f.list).toHaveBeenCalledWith('', expect.any(AbortSignal))
  })

  it('shows the empty-directory notice', async () => {
    render(<FilesView {...face()} t={t} />)
    await screen.findByText(zh['panel.empty'])
  })

  it('navigates into a directory and re-lists with the joined path', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('src', 'directory')])),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('src/')
    await act(async () => { fireEvent.click(screen.getByText('src/')) })
    await waitFor(() => expect(f.list).toHaveBeenCalledWith('src', expect.any(AbortSignal)))
  })

  it('navigates two levels deep and shows breadcrumbs', async () => {
    const f = face({
      list: vi.fn(async (path: string) => path === ''
        ? listing([entry('src', 'directory')])
        : listing([entry('lib', 'directory')])),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('src/')
    await act(async () => { fireEvent.click(screen.getByText('src/')) })
    await screen.findByText('lib/')
    await act(async () => { fireEvent.click(screen.getByText('lib/')) })
    await waitFor(() => expect(f.list).toHaveBeenCalledWith('src/lib', expect.any(AbortSignal)))
    // The root crumb and the two segment crumbs are all present.
    expect(screen.getByText(zh['panel.root'])).toBeTruthy()
    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.getByText('lib')).toBeTruthy()
  })

  it('navigates back through a segment crumb and the root crumb', async () => {
    const f = face({
      list: vi.fn(async (path: string) => path === ''
        ? listing([entry('src', 'directory')])
        : listing([entry('lib', 'directory')])),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('src/')
    await act(async () => { fireEvent.click(screen.getByText('src/')) })
    await screen.findByText('lib/')
    await act(async () => { fireEvent.click(screen.getByText('lib/')) })
    await waitFor(() => expect(f.list).toHaveBeenCalledWith('src/lib', expect.any(AbortSignal)))
    // The 'src' crumb jumps back to src; the root crumb jumps to the root.
    await act(async () => { fireEvent.click(screen.getByText('src')) })
    await waitFor(() => expect(f.list).toHaveBeenCalledWith('src', expect.any(AbortSignal)))
    await act(async () => { fireEvent.click(screen.getByText(zh['panel.root'])) })
    await waitFor(() => expect(f.list).toHaveBeenCalledWith('', expect.any(AbortSignal)))
  })

  it('renders the message of a string rejection', async () => {
    const f = face({ list: vi.fn(async () => { throw 'plain-string' }) })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('plain-string')
  })

  it('shows the listing error message', async () => {
    const f = face({ list: vi.fn(async () => { throw new Error('listing denied') }) })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('listing denied')
  })

  it('formats KB and MB sizes', async () => {
    const f = face({
      list: vi.fn(async () => listing([
        entry('k.txt', 'file', 2048),
        entry('m.bin', 'file', 3 * 1024 * 1024),
      ])),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('k.txt')
    expect(screen.getByText('2.0 KB')).toBeTruthy()
    expect(screen.getByText('3.0 MB')).toBeTruthy()
  })

  it('shows the not-text notice for an other-type entry', async () => {
    const f = face({ list: vi.fn(async () => listing([entry('weird', 'other')])) })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('weird')
    await act(async () => { fireEvent.click(screen.getByText('weird')) })
    await screen.findByText(zh['panel.notText'])
  })

  it('ignores an aborted list resolution (no error notice)', async () => {
    const f = face({
      list: vi.fn((_path: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })),
    })
    const { unmount } = render(<FilesView {...f} t={t} />)
    await act(async () => { unmount() })
    expect(f.list).toHaveBeenCalledTimes(1)
  })
})

describe('FilesView editor', () => {
  it('opens a file into the editor and saves the draft', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('a.txt', 'file', 11)])),
      read: vi.fn(async (): Promise<FileContent> => ({ content: 'hello world', size: 11, truncated: false })),
      write: vi.fn(async () => ({ operation: 'update' as const, version: 'v2', bytes: 12 })),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('a.txt')
    await act(async () => { fireEvent.click(screen.getByText('a.txt')) })
    const textarea = await screen.findByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('hello world')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello again' } })
    })
    await act(async () => { fireEvent.click(screen.getByText(zh['panel.save'])) })
    await screen.findByText(zh['panel.saved'])
    expect(f.write).toHaveBeenCalledWith('a.txt', 'hello again')
  })

  it('refuses to edit truncated content (read-only textarea, save disabled)', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('big.txt', 'file', 100)])),
      read: vi.fn(async (): Promise<FileContent> => ({ content: '01234', size: 100, truncated: true })),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('big.txt')
    await act(async () => { fireEvent.click(screen.getByText('big.txt')) })
    await screen.findByText(zh['panel.truncated'])
    const textarea = await screen.findByRole('textbox') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
    expect((screen.getByText(zh['panel.save']) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the save failure as a notice', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('a.txt', 'file', 11)])),
      read: vi.fn(async (): Promise<FileContent> => ({ content: 'hello world', size: 11, truncated: false })),
      write: vi.fn(async () => { throw new Error('file-write-failed') }),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('a.txt')
    await act(async () => { fireEvent.click(screen.getByText('a.txt')) })
    await act(async () => { fireEvent.click(await screen.findByText(zh['panel.save'])) })
    await screen.findByText('file-write-failed')
  })

  it('renders the message of a string save rejection', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('a.txt', 'file', 11)])),
      read: vi.fn(async (): Promise<FileContent> => ({ content: 'hello world', size: 11, truncated: false })),
      write: vi.fn(async () => { throw 'plain-string' }),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('a.txt')
    await act(async () => { fireEvent.click(screen.getByText('a.txt')) })
    await act(async () => { fireEvent.click(await screen.findByText(zh['panel.save'])) })
    await screen.findByText('plain-string')
  })

  it('downloads from the open editor and closes it', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('a.txt', 'file', 11)])),
      read: vi.fn(async (): Promise<FileContent> => ({ content: 'hello world', size: 11, truncated: false })),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('a.txt')
    await act(async () => { fireEvent.click(screen.getByText('a.txt')) })
    // The editor toolbar has its own download button (the row download was
    // already exercised; getAllByText distinguishes the two).
    await act(async () => { fireEvent.click(screen.getByText(zh['panel.download'])) })
    expect(f.download).toHaveBeenCalledWith('a.txt')
    await act(async () => { fireEvent.click(screen.getByText(zh['panel.close'])) })
    expect(screen.queryByRole('textbox')).toBeNull()
    // Closing returns to the listing.
    await screen.findByText('a.txt')
  })

  it('shows the read error as a notice', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('bin.dat', 'file', 4)])),
      read: vi.fn(async () => { throw new Error('file-not-text') }),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('bin.dat')
    await act(async () => { fireEvent.click(screen.getByText('bin.dat')) })
    await screen.findByText('file-not-text')
  })

  it('renders the message of a string read rejection', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('a.txt', 'file', 1)])),
      read: vi.fn(async () => { throw 'plain-string' }),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('a.txt')
    await act(async () => { fireEvent.click(screen.getByText('a.txt')) })
    await screen.findByText('plain-string')
  })
})

describe('FilesView transfer', () => {
  it('downloads a file through the injected operation', async () => {
    const f = face({
      list: vi.fn(async () => listing([entry('a.txt', 'file', 5)])),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText('a.txt')
    await act(async () => { fireEvent.click(screen.getAllByText(zh['panel.download'])[0] as HTMLElement) })
    expect(f.download).toHaveBeenCalledWith('a.txt')
  })

  it('shows the upload failure as a notice', async () => {
    const f = face({
      list: vi.fn(async () => listing([])),
      upload: vi.fn(async () => { throw new Error('file-too-large') }),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText(zh['panel.empty'])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'big.bin', { type: 'application/octet-stream' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    await screen.findByText('file-too-large')
  })

  it('renders the message of a string upload rejection', async () => {
    const f = face({
      list: vi.fn(async () => listing([])),
      upload: vi.fn(async () => { throw 'plain-string' }),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText(zh['panel.empty'])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'a.bin', { type: 'application/octet-stream' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    await screen.findByText('plain-string')
  })

  it('ignores an upload without a selected file', async () => {
    const f = face({ list: vi.fn(async () => listing([])) })
    render(<FilesView {...f} t={t} />)
    await screen.findByText(zh['panel.empty'])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { files: [] } }) })
    expect(f.upload).not.toHaveBeenCalled()
  })

  it('the refresh button re-lists the current directory', async () => {
    const f = face({ list: vi.fn(async () => listing([])) })
    render(<FilesView {...f} t={t} />)
    await screen.findByText(zh['panel.empty'])
    await act(async () => { fireEvent.click(screen.getByText(zh['panel.refresh'])) })
    await waitFor(() => expect(f.list).toHaveBeenCalledTimes(2))
  })

  it('the upload button opens the hidden file input', async () => {
    const f = face({ list: vi.fn(async () => listing([])) })
    render(<FilesView {...f} t={t} />)
    await screen.findByText(zh['panel.empty'])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => undefined)
    await act(async () => { fireEvent.click(screen.getByText(zh['panel.upload'])) })
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('uploads a selected file as base64 and re-lists', async () => {
    const f = face({
      list: vi.fn(async () => listing([])),
      upload: vi.fn(async () => ({ operation: 'create' as const, version: 'v1', bytes: 3 })),
    })
    render(<FilesView {...f} t={t} />)
    await screen.findByText(zh['panel.empty'])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'blob.bin', { type: 'application/octet-stream' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    await screen.findByText(zh['panel.uploaded'])
    expect(f.upload).toHaveBeenCalledWith('blob.bin', 'AQID')
    expect(f.list).toHaveBeenCalledTimes(2)
  })
})
