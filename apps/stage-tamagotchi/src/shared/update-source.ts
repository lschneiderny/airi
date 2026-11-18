import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

/** The update settings that `ergo.config.ts` builds into the launcher. */
export interface UpdateSource {
  disabled: boolean
  feedUrl: string
  publicKeys: string[]
}

/** The part of `process` that tells how an install gets its updates. */
export interface UpdateHost {
  env: Record<string, string | undefined>
  platform: string
}

/**
 * The config schema of `@ergosphere-it/electron` requires a feed URL and one Ed25519 key also when updates are off, so
 * a build without a feed carries values that no release can use. The `.invalid` domain never resolves (RFC 2606).
 */
const unusedFeedUrl = 'https://updates.invalid'

/**
 * An Ed25519 public key in PEM form whose 32 key bytes are a SHA-256 digest. Nobody knows a private key for it, so no
 * bundle verifies against it.
 */
function unusedPublicKey() {
  // The fixed DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410), then the key bytes.
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    createHash('sha256').update('airi fork: updates are off, no release key exists').digest(),
  ])
  return `-----BEGIN PUBLIC KEY-----\n${der.toString('base64')}\n-----END PUBLIC KEY-----\n`
}

/**
 * Returns the update source of a build. The fork has no release store, so a build has no default feed and no default
 * key: updates are off unless the build sets both `AIRI_UPDATE_FEED_URL` and `AIRI_UPDATE_PUBLIC_KEY`. Steam updates
 * the Steam build, so its updater is off with any feed.
 */
export function updateSourceFromEnv(env: Record<string, string | undefined>): UpdateSource {
  const feedUrl = env.AIRI_UPDATE_FEED_URL
  const publicKey = env.AIRI_UPDATE_PUBLIC_KEY
  if (!feedUrl || !publicKey)
    return { disabled: true, feedUrl: unusedFeedUrl, publicKeys: [unusedPublicKey()] }

  return { disabled: env.VITE_DISTRIBUTION === 'steam', feedUrl, publicKeys: [publicKey] }
}

/**
 * Returns whether the updater of this install is off. The launcher in `src/launcher/index.ts` is the only caller: it
 * starts the ergosphere-it updater as disabled, and the main process reads that status, so the two cannot disagree.
 *
 * - `configDisabled` is `disabled` of `ergo.config.ts`: a build without a feed, or a Steam build.
 * - Flatpak and Nix installs use the build of the deb and rpm packages, so only the runtime can tell them. Flatpak
 *   sets `FLATPAK_ID` in each sandbox, and the `nix/package.nix` launcher sets `AIRI_DISTRIBUTION=nix`. Their package
 *   managers update the app.
 * - Squirrel.Mac installs only updates that pass code-signature validation against the running app. Fork macOS builds
 *   are ad-hoc signed, so their updates are manual downloads.
 */
export function isUpdaterDisabled(configDisabled: boolean, host: UpdateHost): boolean {
  return configDisabled
    || host.platform === 'darwin'
    || !!host.env.FLATPAK_ID
    || host.env.AIRI_DISTRIBUTION === 'nix'
}
