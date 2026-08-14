import { describe, expect, it, vi } from 'vitest'
import { randomUuid } from '../src/api/random-uuid.ts'

const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  it('mints RFC 4122 version 4 UUIDs from getRandomValues', () => {
    expect(randomUuid()).toMatch(V4_UUID)
    expect(randomUuid()).not.toBe(randomUuid())
  })

  it('works when crypto.randomUUID is unavailable, as on insecure origins', () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('crypto.randomUUID is a secure-context-only API')
    })
    try {
      expect(randomUuid()).toMatch(V4_UUID)
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
  })
})
