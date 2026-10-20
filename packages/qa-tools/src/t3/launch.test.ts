import { describe, expect, it } from 'vitest'

import { fatalStartupPattern, stageTargetPattern, t3LaunchEnv } from './launch'

describe('t3LaunchEnv', () => {
  it('sets the fresh profile, the debug port without the browser, and the bridge gate', () => {
    expect(t3LaunchEnv('C:/run/profile', 9333)).toEqual({
      APP_USER_DATA_PATH: 'C:/run/profile',
      APP_REMOTE_DEBUG: 'true',
      APP_REMOTE_DEBUG_PORT: '9333',
      APP_REMOTE_DEBUG_NO_OPEN: 'true',
      APP_MOTION_QA_BRIDGE: 'true',
    })
  })
})

describe('stageTargetPattern', () => {
  it('matches only the synced leader on the root route', () => {
    expect(stageTargetPattern.test('http://localhost:5174/?synced-leader=true#/')).toBe(true)
    expect(stageTargetPattern.test('http://localhost:5174/?synced-leader=true#/settings')).toBe(false)
    expect(stageTargetPattern.test('http://localhost:5174/#/')).toBe(false)
  })
})

describe('fatalStartupPattern', () => {
  it('captures the load error and the line after it', () => {
    const log = 'starting electron app...\nApp threw an error during load\nError: EBUSY: resource busy or locked, open \'x.js\'\n    at Object.openSync'
    expect(fatalStartupPattern.exec(log)?.[0]).toBe('App threw an error during load\nError: EBUSY: resource busy or locked, open \'x.js\'')
  })

  it('ignores ordinary dev output', () => {
    expect(fatalStartupPattern.test('electron main process built successfully\nstarting electron app...')).toBe(false)
  })
})
