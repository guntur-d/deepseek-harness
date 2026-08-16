// @vitest-environment jsdom
/**
 * Source-level registration acceptance on the real framework stack: the
 * plugin fiber registers the Files tab into a real SlotRegistry view ring
 * (source apply, not the built bundle), and fiber disposal removes the tab.
 * The built-artifact handoff is covered by client-bundle.client.spec.ts.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-files/client'

afterEach(() => {
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('source registration', () => {
  it('registers the Files tab on the real ring and disposes it', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    // The conversation entry's role: the ring must be declared before riders land.
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    // The locale plugin backs the locale-aware view tab label; its settings
    // scope needs a connection handle and the Host-facing settings/remote seams.
    // The files domain stub lets the injected operations resolve to real values.
    ctx.provide('connection', {
      api: {
        settings: {},
        files: {
          list: async () => ({ rpcId: 'r1', result: { ok: true as const, value: { path: '', entries: [], truncated: false } } }),
          read: async () => ({ rpcId: 'r2', result: { ok: true as const, value: { content: 'x', size: 1, truncated: false } } }),
          write: async () => ({ rpcId: 'r3', result: { ok: true as const, value: { operation: 'update' as const, version: 'v1', bytes: 1 } } }),
          upload: async () => ({ rpcId: 'r4', result: { ok: true as const, value: { operation: 'create' as const, version: 'v1', bytes: 1 } } }),
        },
      },
      isLoopback: false,
    } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    let fileTrigger: import('@deepseek-ai/dsh-client-ui-input-trigger/client').InputTriggerSource | undefined
    ctx.provide('inputTriggers', {
      registerSource: (src: import('@deepseek-ai/dsh-client-ui-input-trigger/client').InputTriggerSource) => {
        fileTrigger = src
        return () => {}
      },
    } as never)
    ctx.plugin({ inject: [...localeInject], apply: localeApply })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = slots.entries('conversation.view')
    expect(entries.map(e => e.options.id)).toEqual(['files'])
    // The '@' trigger source rides the same fiber: workspace files, @ trigger.
    expect(fileTrigger?.trigger).toBe('@')
    expect(fileTrigger?.name).toBe('files')
    const candidates = await fileTrigger?.candidates?.({ sessionId: 'session-1' } as never, {
      query: '',
      position: 'leading',
      signal: new AbortController().signal,
    })
    expect(candidates).toEqual([])
    expect(entries[0]?.options.order).toBe(20)
    expect(entries[0]?.options.label).toBeTypeOf('function')
    // The view tab label resolves through the bound translator.
    const label = entries[0]?.options.label as (() => string) | undefined
    expect(['Files', '文件']).toContain(label?.())
    // The inject factory binds the session into the file operations; calling
    // it exercises the closures the component will drive.
    const injected = entries[0]?.inject as ((sessionId: string) => object) | undefined
    expect(typeof injected).toBe('function')
    const face = injected?.('session-1') as {
      list: (path: string, signal: AbortSignal) => Promise<{ entries: readonly unknown[] }>
      read: (path: string, signal: AbortSignal) => Promise<{ content: string }>
      write: (path: string, content: string) => Promise<{ operation: string }>
      upload: (path: string, data: string) => Promise<{ operation: string }>
      download: (path: string) => void
    }
    expect(typeof face.list).toBe('function')
    expect(typeof face.read).toBe('function')
    expect(typeof face.write).toBe('function')
    expect(typeof face.upload).toBe('function')
    expect(typeof face.download).toBe('function')
    // Exercise the session-bound operations through the stub api.
    expect((await face.list('', new AbortController().signal)).entries).toEqual([])
    expect((await face.read('a.txt', new AbortController().signal)).content).toBe('x')
    expect((await face.write('a.txt', 'y')).operation).toBe('update')
    expect((await face.upload('a.bin', 'AA==')).operation).toBe('create')
    // download builds a same-origin anchor and clicks it; stub the click to
    // avoid jsdom's unimplemented navigation.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    expect(() => { face.download('a.txt') }).not.toThrow()
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // Without a location (fixture/non-browser contexts) the download URL falls
    // back to the internal host; the anchor still resolves.
    const locationHolder = globalThis.location
    ;(globalThis as { location?: unknown }).location = undefined
    expect(() => { face.download('deep/nested.bin') }).not.toThrow()
    ;(globalThis as { location?: unknown }).location = locationHolder
    expect(clickSpy).toHaveBeenCalledTimes(2)
    clickSpy.mockRestore()
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('surfaces failing RPCs as thrown Errors for the panel', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    ctx.provide('connection', {
      api: {
        settings: {},
        files: {
          list: async () => ({ rpcId: 'r1', result: { ok: false as const, error: { code: 'file-not-found' as const, message: 'nope', details: { path: 'x' } } } }),
          read: async () => ({ rpcId: 'r2', result: { ok: false as const, error: { code: 'file-not-text' as const, message: 'binary', details: { path: 'x' } } } }),
          write: async () => ({ rpcId: 'r3', result: { ok: false as const, error: { code: 'file-write-failed' as const, message: 'stale', details: { path: 'x' } } } }),
          upload: async () => ({ rpcId: 'r4', result: { ok: false as const, error: { code: 'file-too-large' as const, message: 'huge', details: { path: 'x' } } } }),
        },
      },
      isLoopback: false,
    } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    ctx.provide('inputTriggers', { registerSource: () => () => {} } as never)
    ctx.plugin({ inject: [...localeInject], apply: localeApply })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const injected = slots.entries('conversation.view')[0]?.inject as ((sessionId: string) => object) | undefined
    const failing = injected?.('session-1') as {
      list: (path: string, signal: AbortSignal) => Promise<unknown>
      read: (path: string, signal: AbortSignal) => Promise<unknown>
      write: (path: string, content: string) => Promise<unknown>
      upload: (path: string, data: string) => Promise<unknown>
    }
    await expect(failing.list('', new AbortController().signal)).rejects.toThrow('nope')
    await expect(failing.read('x', new AbortController().signal)).rejects.toThrow('binary')
    await expect(failing.write('x', 'y')).rejects.toThrow('stale')
    await expect(failing.upload('x', 'AA==')).rejects.toThrow('huge')
    await fiber.dispose()
  })
})
