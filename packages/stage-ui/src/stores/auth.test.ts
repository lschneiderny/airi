import type { Session, User } from 'better-auth'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { triggerSignIn } from '../libs/auth'
import { requestAuthSession } from '../libs/auth-client'
import { useAuthStore } from './auth'

vi.mock('../libs/auth', () => ({
  triggerSignIn: vi.fn(),
}))

vi.mock('../libs/auth-client', () => ({
  authClient: {
    listSessions: vi.fn(),
  },
  requestAuthSession: vi.fn(),
}))

vi.mock('../libs/auth-oidc', () => ({
  refreshAccessToken: vi.fn(),
}))

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const user: User = {
  id: 'user-1',
  name: 'AIRI User',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const session: Session = {
  id: 'session-1',
  token: 'server-session-token',
  userId: user.id,
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('auth store sign-in requests', () => {
  let storage: MemoryStorage
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    // Authentication also requests credits. Keep that HTTP boundary inside the test.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flux: 0 })))
    pinia = createPinia()
    setActivePinia(pinia)
    vi.mocked(triggerSignIn).mockReset()
    vi.mocked(triggerSignIn).mockResolvedValue()
    vi.mocked(requestAuthSession).mockReset()
    vi.mocked(requestAuthSession).mockResolvedValue({ user, session })
  })

  afterEach(() => {
    disposePinia(pinia)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not launch sign-in when a hosted request asks for login', async () => {
    const authStore = useAuthStore()

    await authStore.requestLogin()
    await nextTick()

    expect(triggerSignIn).not.toHaveBeenCalled()
    expect(authStore.isAuthenticated).toBe(false)
  })

  it('queries the session with the token from the completed sign-in', async () => {
    const authStore = useAuthStore()

    // ROOT CAUSE:
    //
    // The old callback queried the session through a raw localStorage read.
    // VueUse writes storage on the next microtask, so that request could use
    // the previous token and then clear the complete auth state.
    await authStore.completeSignIn({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      idToken: 'new-id-token',
      expiresIn: 3600,
      clientId: 'airi-stage-electron',
    })

    expect(requestAuthSession).toHaveBeenCalledWith('new-access-token')
    expect(authStore.token).toBe('new-access-token')
    expect(authStore.refreshToken).toBe('new-refresh-token')
    expect(authStore.idToken).toBe('new-id-token')
    expect(authStore.user).toEqual(user)
    expect(authStore.session).toEqual(session)
    expect(storage.getItem('auth/v1/token')).toBe('new-access-token')
    expect(storage.getItem('auth/v1/refresh-token')).toBe('new-refresh-token')
    expect(storage.getItem('auth/v1/oidc-id-token')).toBe('new-id-token')
    expect(storage.getItem('auth/v1/oidc-client-id')).toBe('airi-stage-electron')
    expect(storage.getItem('auth/v1/oidc-token-expiry')).not.toBeNull()

    await authStore.clearAllAuthState()
  })

  it('removes saved AIRI credentials without requesting a hosted session on startup', async () => {
    storage.values.set('auth/v1/token', 'persisted-access-token')
    storage.values.set('auth/v1/refresh-token', 'persisted-refresh-token')
    storage.values.set('auth/v1/oidc-id-token', 'persisted-id-token')
    storage.values.set('auth/v1/oidc-client-id', 'airi-stage-web')
    storage.values.set('auth/v1/oidc-token-expiry', String(Date.now() + 60_000))
    storage.values.set('direct-provider-key', 'keep-this-key')
    const authStore = useAuthStore()

    expect(authStore.token).toBeNull()

    await authStore.initialize()

    expect(requestAuthSession).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(authStore.token).toBeNull()
    expect(authStore.userId).toBe('local')
    expect(storage.getItem('auth/v1/token')).toBeNull()
    expect(storage.getItem('auth/v1/refresh-token')).toBeNull()
    expect(storage.getItem('auth/v1/oidc-id-token')).toBeNull()
    expect(storage.getItem('auth/v1/oidc-client-id')).toBeNull()
    expect(storage.getItem('auth/v1/oidc-token-expiry')).toBeNull()
    expect(storage.getItem('direct-provider-key')).toBe('keep-this-key')
  })

  it('reads the capacitor percent and fallback choice with the Flux balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flux: 5, capacitorPercent: 40, capacitorRechargesAt: '2026-10-11T06:00:00.000Z', fallbackToFlux: true })))
    const authStore = useAuthStore()
    authStore.$patch({ user, session })

    await authStore.updateCredits()

    expect(authStore.credits).toBe(5)
    expect(authStore.capacitorPercent).toBe(40)
    expect(authStore.capacitorRechargesAt).toBe('2026-10-11T06:00:00.000Z')
    expect(authStore.fallbackToFlux).toBe(true)
  })

  it('handles a failed background credit refresh without delaying authentication hooks', async () => {
    const request = Promise.withResolvers<Response>()
    const reported = Promise.withResolvers<unknown[]>()
    vi.stubGlobal('fetch', vi.fn(() => request.promise))
    vi.spyOn(console, 'error').mockImplementation((...args) => reported.resolve(args))
    const authStore = useAuthStore()
    const authenticated = vi.fn()
    authStore.onAuthenticated(authenticated)
    authStore.needsLogin = true
    authStore.$patch({ user, session, credits: 5 })

    await nextTick()

    expect(authenticated).toHaveBeenCalledOnce()
    expect(authStore.needsLogin).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()

    const failure = new TypeError('Failed to fetch')
    request.reject(failure)
    expect(await reported.promise).toContain(failure.message)
    expect(authStore.isAuthenticated).toBe(true)
    expect(authStore.credits).toBe(5)
  }, 5_000)

  it('does not persist state patches received from another window', async () => {
    const authStore = useAuthStore()

    // ROOT CAUSE:
    //
    // `useLocalStorage` observed every Pinia patch and wrote it to storage.
    // The storage event then reached another window, whose synced Pinia patch
    // wrote the same value back. This formed an unbounded cross-window loop.
    // Auth persistence now runs only inside auth commands.
    authStore.$patch({ token: 'synced-access-token' })
    await nextTick()

    expect(storage.values.size).toBe(0)
  })
})
