import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { MMDStanceInteraction, MMDStanceWorld } from './stance'

import { MOVE_TOOL_REFRACTORY_MS, NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MMDBodyToolPort } from './body-tool-port'
import { CHAT_STAND_GAP_LEGS, chatStandX, MMDStanceDirector } from './stance'

const idle: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'idle', attention: 'camera', away: false }
const EPOCH_MS = 1_000_000
const quiet: MMDStanceInteraction = { interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, actionRequest: null, actionFeedback: null, dragging: false }
const unitsPerDip = 1 / 15
const legLength = 9
const halfWidth = 2.7
const chat = { minX: -190 * unitsPerDip, maxX: 190 * unitsPerDip }

interface Setup {
  rootX: number
  homeX: number
}

/** Drives the real director and the port the way the scene does, one frame per call. */
function stage({ rootX, homeX }: Setup) {
  const director = new MMDStanceDirector()
  const port = new MMDBodyToolPort()
  const standX = chatStandX(chat, rootX, homeX, halfWidth, legLength)
  function frame(atMs: number, patch: Partial<MMDStanceWorld> = {}) {
    const world: MMDStanceWorld = {
      ...NO_WORLD_BODY_INPUT,
      ground: { minX: -80, maxX: 80 },
      legLength,
      rootX,
      homeX,
      chatX: standX,
      toolRequest: port.request,
      ...patch,
    }
    const directorMs = EPOCH_MS + atMs
    director.update({ interaction: quiet, nowMs: directorMs, performance: idle, slots: {}, idleMotionName: '', isRegistered: () => true, world })
    port.observe({
      rootX,
      homeX,
      standX: standX + Math.sign(homeX - standX) * legLength,
      locomotionMode: world.locomotionMode,
      directorMs,
      diagnostics: director.diagnostics,
    })
  }
  return { director, port, frame }
}

describe('mmd body tool port with the stance director', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops beside the chat for come_here, not inside it, for either root side and home side', async () => {
    for (const rootSide of [1, -1]) {
      for (const homeSide of [1, -1]) {
        const { director, port, frame } = stage({ rootX: rootSide * 30, homeX: homeSide * 40 })
        frame(0)

        const answer = port.comeHere()
        frame(100)
        const result = await answer

        const label = `root ${rootSide > 0 ? 'right' : 'left'}, home ${homeSide > 0 ? 'right' : 'left'}`
        const edge = rootSide > 0 ? chat.maxX : chat.minX
        const goalX = director.diagnostics.goalX!
        expect(result.success, label).toBe(true)
        expect(director.diagnostics.reason, label).toBe('tool')
        expect(goalX, label).toBeCloseTo(edge + rootSide * (halfWidth + CHAT_STAND_GAP_LEGS * legLength))
        expect(goalX - halfWidth >= chat.maxX || goalX + halfWidth <= chat.minX, label).toBe(true)
      }
    }
  })

  it('walks come_here to the same spot as an unfolded chat', async () => {
    const approach = stage({ rootX: 30, homeX: 40 })
    approach.frame(0)
    approach.frame(100, { chatUnfoldSeq: 1 })

    const tool = stage({ rootX: 30, homeX: 40 })
    tool.frame(0)
    const answer = tool.port.comeHere()
    tool.frame(100)
    await answer

    expect(approach.director.diagnostics.reason).toBe('approach-chat')
    expect(tool.director.diagnostics.goalX).toBeCloseTo(approach.director.diagnostics.goalX!)
  })

  it('refuses a second come_here inside the refractory with a retry delay, and accepts look_at one second later', async () => {
    const { director, port, frame } = stage({ rootX: 30, homeX: 40 })
    frame(0)

    const first = port.comeHere()
    frame(100)
    expect((await first).success).toBe(true)

    const second = port.comeHere()
    frame(10_100)
    const refused = await second
    expect(refused.success).toBe(false)
    expect(refused.retryAfterSeconds).toBe(Math.ceil((MOVE_TOOL_REFRACTORY_MS - 10_000) / 1000))
    expect(director.diagnostics.toolRefused).toBe(true)

    const look = port.lookAt('cursor')
    frame(11_100)
    expect((await look).success).toBe(true)
  })

  it('reports where she stands and how long the movement tools are blocked', async () => {
    const atHome = stage({ rootX: 40, homeX: 40 })
    expect(atHome.port.state()).toEqual({ position: 'elsewhere', moving: false, refractorySeconds: 0 })
    atHome.frame(0)
    expect(atHome.port.state()).toEqual({ position: 'home', moving: false, refractorySeconds: 0 })

    const answer = atHome.port.goHome()
    atHome.frame(1_000)
    await answer
    expect(atHome.port.state().refractorySeconds).toBe(60)
    atHome.frame(31_000)
    expect(atHome.port.state().refractorySeconds).toBe(30)
  })

  it('fails a request the director never answers, and one a newer request replaced', async () => {
    vi.useFakeTimers()
    const { port } = stage({ rootX: 0, homeX: 0 })

    const lost = port.comeHere()
    const replaced = port.goHome()
    await expect(lost).resolves.toMatchObject({ success: false })

    const unanswered = expect(replaced).resolves.toMatchObject({ success: false, error: 'The stage did not answer the request.' })
    await vi.advanceTimersByTimeAsync(2_000)
    await unanswered
  })

  it('withdraws a timed-out request, so a stage that resumes after a stall does not walk her', async () => {
    vi.useFakeTimers()
    const { director, port, frame } = stage({ rootX: 30, homeX: 40 })
    frame(0)

    const stalled = port.comeHere()
    expect(port.request?.kind).toBe('come-here')
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(stalled).resolves.toMatchObject({ success: false, error: 'The stage did not answer the request.' })

    expect(port.request).toBeNull()
    frame(2_100)
    expect(director.diagnostics.reason).toBe('stay')
    expect(director.diagnostics.goalX).toBeNull()
  })

  it('fails and withdraws the pending request when the scene is disposed', async () => {
    const { port } = stage({ rootX: 0, homeX: 0 })
    const pending = port.comeHere()

    port.dispose()

    await expect(pending).resolves.toMatchObject({ success: false })
    expect(port.request).toBeNull()
  })
})
