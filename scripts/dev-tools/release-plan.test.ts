import { describe, expect, it } from 'vitest'

import { checkExistingRelease, checkGitState, isReleaseArtifact, parseReleaseArgs, releaseTarget } from './release-plan'

describe('parseReleaseArgs', () => {
  it('accepts a calendar version and the dry-run flag', () => {
    expect(parseReleaseArgs(['2026.11.0', '--dry-run'])).toEqual({ version: '2026.11.0', dryRun: true })
  })

  it.each(['0.15.2', '2026.011.0', '2026.13.0', 'v2026.11.0', '2026.11.0-beta.1'])('rejects %s', (version) => {
    expect(parseReleaseArgs([version])).toHaveProperty('error')
  })

  it('rejects a missing version and unknown options', () => {
    expect(parseReleaseArgs([])).toHaveProperty('error')
    expect(parseReleaseArgs(['2026.11.0', '--publish'])).toHaveProperty('error')
  })
})

describe('checkGitState', () => {
  it('passes a clean main that matches origin', () => {
    expect(checkGitState({ branch: 'main', dirty: false, head: 'a', originHead: 'a' })).toEqual([])
  })

  it('reports every blocking condition', () => {
    expect(checkGitState({ branch: 'topic', dirty: true, head: 'a', originHead: 'b' })).toHaveLength(3)
  })
})

describe('checkExistingRelease', () => {
  it('lets a platform add files to a draft of the same commit', () => {
    expect(checkExistingRelease({ isDraft: true, targetCommitish: 'a' }, 'a')).toBeUndefined()
  })

  it('refuses a published release or a draft of another commit', () => {
    expect(checkExistingRelease({ isDraft: false, targetCommitish: 'a' }, 'a')).toBeDefined()
    expect(checkExistingRelease({ isDraft: true, targetCommitish: 'b' }, 'a')).toBeDefined()
  })
})

describe('isReleaseArtifact', () => {
  it('keeps installers and updater feeds, and skips build leftovers', () => {
    const files = ['AIRI-2026.11.0-linux-amd64.deb', 'AIRI-2026.11.0-mac-arm64.dmg.blockmap', 'latest-x64-linux.yml', 'builder-debug.yml', 'builder-effective-config.yaml', 'linux-unpacked']
    expect(files.filter(isReleaseArtifact)).toEqual(files.slice(0, 3))
  })
})

describe('releaseTarget', () => {
  it('picks the Godot preset for the Linux architecture and defers Windows', () => {
    expect(releaseTarget('linux', 'arm64')?.godotPreset).toBe('Linux arm64')
    expect(releaseTarget('darwin', 'arm64')?.builderFlag).toBe('--mac')
    expect(releaseTarget('win32', 'x64')).toBeUndefined()
  })
})
