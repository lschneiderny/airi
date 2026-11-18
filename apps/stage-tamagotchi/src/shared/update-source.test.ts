import { createPublicKey } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { isUpdaterDisabled, updateSourceFromEnv } from './update-source'

const feed = { AIRI_UPDATE_FEED_URL: 'https://updates.example.com', AIRI_UPDATE_PUBLIC_KEY: 'ssh-ed25519 AAAAexample' }

describe('updateSourceFromEnv', () => {
  it.each([
    { name: 'no feed and no key', env: {} },
    { name: 'a feed without a key', env: { AIRI_UPDATE_FEED_URL: feed.AIRI_UPDATE_FEED_URL } },
    { name: 'a key without a feed', env: { AIRI_UPDATE_PUBLIC_KEY: feed.AIRI_UPDATE_PUBLIC_KEY } },
    { name: 'an empty feed', env: { ...feed, AIRI_UPDATE_FEED_URL: '' } },
  ])('turns updates off for a build with $name', ({ env }) => {
    const source = updateSourceFromEnv(env)

    expect(source.disabled).toBe(true)
    expect(new URL(source.feedUrl).hostname.endsWith('.invalid')).toBe(true)
    expect(source.publicKeys).toHaveLength(1)
    expect(source.publicKeys).not.toContain(feed.AIRI_UPDATE_PUBLIC_KEY)
    expect(createPublicKey(source.publicKeys[0]).asymmetricKeyType).toBe('ed25519')
  })

  it('uses the feed and the key of a build that sets both', () => {
    expect(updateSourceFromEnv(feed)).toEqual({
      disabled: false,
      feedUrl: feed.AIRI_UPDATE_FEED_URL,
      publicKeys: [feed.AIRI_UPDATE_PUBLIC_KEY],
    })
  })

  it('keeps updates off in a Steam build that sets a feed', () => {
    expect(updateSourceFromEnv({ ...feed, VITE_DISTRIBUTION: 'steam' }).disabled).toBe(true)
  })
})

describe('isUpdaterDisabled', () => {
  it.each([
    { name: 'a Flatpak sandbox', configDisabled: false, platform: 'linux', env: { FLATPAK_ID: 'ai.moeru.airi' }, expected: true },
    { name: 'a Nix package', configDisabled: false, platform: 'linux', env: { AIRI_DISTRIBUTION: 'nix' }, expected: true },
    { name: 'an ad-hoc signed macOS build', configDisabled: false, platform: 'darwin', env: {}, expected: true },
    { name: 'a build without a feed', configDisabled: true, platform: 'linux', env: {}, expected: true },
    { name: 'a direct download with a feed', configDisabled: false, platform: 'linux', env: {}, expected: false },
    { name: 'a Windows install with a feed', configDisabled: false, platform: 'win32', env: {}, expected: false },
  ])('reports $expected for $name', ({ configDisabled, platform, env, expected }) => {
    expect(isUpdaterDisabled(configDisabled, { env, platform })).toBe(expected)
  })
})
