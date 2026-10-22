import type { WebSocketEventOptionalSource } from '@proj-airi/server-sdk'

import type { ExtensionSettings, VideoContextPayload } from '../shared/types'
import type { ClientState } from './client'

import { Client } from '@proj-airi/server-sdk'
import { describe, expect, it, vi } from 'vitest'

import { handleVideoContext } from './client'

const settings: ExtensionSettings = {
  wsUrl: 'ws://localhost:6121/ws',
  token: '',
  enabled: true,
  sendPageContext: true,
  sendVideoContext: true,
  sendSparkNotify: true,
  sendSubtitles: true,
  enableVision: false,
}

const video: VideoContextPayload = {
  site: 'youtube',
  url: 'https://www.youtube.com/watch?v=abc',
  title: 'How tea is made',
  channel: 'Tea Channel',
  videoId: 'abc',
}

/** A connected state whose client records what it sends instead of opening a socket. */
function connectedState() {
  const client = new Client({ name: 'proj-airi:plugin-web-extension', autoConnect: false })
  const sent: WebSocketEventOptionalSource[] = []
  vi.spyOn(client, 'send').mockImplementation((event) => {
    sent.push(event)
    return true
  })
  const state: ClientState = { client, connected: true }
  return { state, sent }
}

describe('web extension spark notify', () => {
  it('routes the video notify to the stage windows and addresses it to the character only', () => {
    const { state, sent } = connectedState()

    handleVideoContext(state, settings, video)

    const notify = sent.find(event => event.type === 'spark:notify')
    expect(notify).toMatchObject({
      data: { headline: 'User is watching: How tea is made', note: 'Channel: Tea Channel', destinations: ['character'] },
      // Stage windows connect as `proj-airi:stage-tamagotchi` or `proj-airi:stage-web`; no peer is named `character`.
      route: { destinations: ['proj-airi:stage-*'] },
    })
  })

  it('sends no notify when spark notify is off', () => {
    const { state, sent } = connectedState()

    handleVideoContext(state, { ...settings, sendSparkNotify: false }, video)

    expect(sent.map(event => event.type)).toEqual(['context:update'])
  })
})
