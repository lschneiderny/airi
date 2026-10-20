import { describe, expect, it } from 'vitest'

import { mainWindowQuery } from './query'

const enabled = { APP_MOTION_QA_BRIDGE: 'true', APP_REMOTE_DEBUG: 'TRUE' }

describe('mainWindowQuery', () => {
  it('requests the motion QA bridge only in development with both variables set', () => {
    expect(mainWindowQuery(true, enabled)).toEqual({ 'synced-leader': 'true', 'motion-qa-bridge': 'true' })
  })

  it.each([
    ['a production build', false, enabled],
    ['no bridge variable', true, { APP_REMOTE_DEBUG: 'true' }],
    ['no remote debug', true, { APP_MOTION_QA_BRIDGE: 'true' }],
    ['a non-true bridge value', true, { APP_MOTION_QA_BRIDGE: '1', APP_REMOTE_DEBUG: 'true' }],
  ])('leaves the bridge off with %s', (_, dev, environment) => {
    expect(mainWindowQuery(dev, environment)).toEqual({ 'synced-leader': 'true' })
  })
})
