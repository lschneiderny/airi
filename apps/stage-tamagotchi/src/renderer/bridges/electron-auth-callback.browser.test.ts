import type { ElectronAuthStatus } from '../../shared/eventa'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { electronAuthCallback, electronAuthComplete, electronAuthGetStatus, electronAuthStatus } from '../../shared/eventa'
import { useAuthStatusStore } from '../stores/auth-status'
import { initializeElectronAuthCallbackBridge } from './electron-auth-callback'

const boundary = vi.hoisted(() => ({
  context: undefined as ReturnType<typeof createContext<unknown, { raw?: unknown }>> | undefined,
  session: vi.fn(),
}))
vi.mock('@proj-airi/electron-vueuse', () => ({ getElectronEventaContext: () => boundary.context }))
vi.mock('@proj-airi/stage-ui/libs/auth-client', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/stage-ui/libs/auth-client')>(),
  requestAuthSession: boundary.session,
}))

let pinia: ReturnType<typeof createPinia>
let completion: ReturnType<typeof Promise.withResolvers<Pick<ElectronAuthStatus, 'attemptId' | 'error'>>>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  completion = Promise.withResolvers()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flux: 7 })))
  boundary.context = createContext<unknown, { raw?: unknown }>()
  boundary.session.mockReset()
  defineInvokeHandler(boundary.context, electronAuthGetStatus, () => undefined)
  defineInvokeHandler(boundary.context, electronAuthComplete, (report) => {
    completion.resolve(report)
  })
})
afterEach(() => {
  disposePinia(pinia)
  vi.unstubAllGlobals()
  localStorage.clear()
})

const tokens = { attemptId: 'attempt-1', accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }

describe('electron auth callback bridge', () => {
  it('reports success only after the exchanged token establishes a real session', async () => {
    const date = new Date()
    boundary.session.mockResolvedValue({
      user: { id: 'user-1', name: 'Test user', email: 'user@example.test', emailVerified: true, createdAt: date, updatedAt: date },
      session: { id: 'session-1', userId: 'user-1', token: 'session-token', expiresAt: date, createdAt: date, updatedAt: date },
    })
    initializeElectronAuthCallbackBridge()
    const authStore = useAuthStore()
    const creditsUpdated = new Promise<void>((resolve) => {
      watch(() => authStore.credits, () => resolve(), { once: true })
    })
    boundary.context!.emit(electronAuthCallback, tokens)
    expect(await completion.promise).toEqual({ attemptId: 'attempt-1', error: undefined })
    await creditsUpdated
    expect(boundary.session).toHaveBeenCalledWith('test-token')
    expect(authStore.isAuthenticated).toBe(true)
    expect(authStore.credits).toBe(7)
  })

  it('reports an error when token exchange succeeds but session confirmation returns false', async () => {
    // ROOT CAUSE:
    // completeSignIn returns false on a missing session. The callback bridge
    // previously ignored that result and had no visible completion feedback.
    boundary.session.mockResolvedValue(null)
    initializeElectronAuthCallbackBridge()
    boundary.context!.emit(electronAuthCallback, tokens)
    expect((await completion.promise).error).toContain('Could not confirm')
    expect(useAuthStore().isAuthenticated).toBe(false)
  })

  it('receives credential-free feedback from another window without changing auth state', () => {
    initializeElectronAuthCallbackBridge()
    boundary.context!.emit(electronAuthStatus, { attemptId: 'another-window', state: 'waiting' })
    expect(useAuthStatusStore().status).toEqual({ attemptId: 'another-window', state: 'waiting' })
    expect(useAuthStore().isAuthenticated).toBe(false)
  })
})
