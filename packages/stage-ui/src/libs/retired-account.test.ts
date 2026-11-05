import { afterEach, expect, it, vi } from 'vitest'

import { removeRetiredAccountCredentials } from './retired-account'

afterEach(() => vi.unstubAllGlobals())

it('removes saved account credentials without changing direct provider credentials or local data', () => {
  const saved = new Map([
    ['auth/v1/token', 'old-access-token'],
    ['auth/v1/refresh-token', 'old-refresh-token'],
    ['auth/v1/oidc-id-token', 'old-id-token'],
    ['auth/v1/oidc-client-id', 'old-client'],
    ['auth/v1/oidc-token-expiry', '1'],
    ['auth/v1/oidc-flow-state', 'unfinished-state'],
    ['auth/v1/oidc-flow-params', 'unfinished-flow'],
    ['settings/credentials/providers', '{"openai":{"apiKey":"direct-key"}}'],
    ['airi-cards', 'local-cards'],
  ])
  vi.stubGlobal('localStorage', { removeItem: (key: string) => saved.delete(key) })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)

  removeRetiredAccountCredentials()
  removeRetiredAccountCredentials()

  expect([...saved]).toEqual([
    ['settings/credentials/providers', '{"openai":{"apiKey":"direct-key"}}'],
    ['airi-cards', 'local-cards'],
  ])
  expect(fetch).not.toHaveBeenCalled()
})
