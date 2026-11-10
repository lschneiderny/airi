import type { MMDMotionSnapshot } from '@proj-airi/stage-ui-mmd/stores'

import en from '@proj-airi/i18n/locales/en'

import { mmdOverlaysOff } from '@proj-airi/stage-ui-mmd/composables/mmd'
import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { until } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import MMDMotionDevtools from './devtools.vue'

import '@proj-airi/ui/main.css'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en },
  })
}

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion'

/** A snapshot like the stage publishes for Vivian with the Natural driver. */
const fixture: Partial<MMDMotionSnapshot> = {
  loadedModelKey: 'vivian-fixture',
  driver: 'natural',
  rig: {
    bones: { hips: 'センター', spine: '上半身', head: '頭', leftUpperLeg: '左足', leftLowerLeg: '左ひざ', leftFoot: '左足首' },
    presentBones: ['hips', 'spine', 'head', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
    missingBones: ['rightUpperLeg'],
    physicsOwnedHumanoid: ['upperChest'],
    hipsTranslation: { center: 'センター', groove: 'グルーブ' },
    legIk: {
      left: { ikBone: '左足ＩＫ', ikBoneIndex: 120, target: '左足首', knee: '左ひざ', upperLeg: '左足', kneeLimit: null },
      right: null,
    },
    toeIk: { left: '左つま先ＩＫ', right: null },
    kneeBendSign: 1,
    kneeBendSource: 'limit',
    legLength: 8.125,
    footBaselineY: 0.731,
    restArmAngle: Math.PI / 5,
    restArmAngles: { left: Math.PI / 5, right: Math.PI / 5 },
    restForearmAngles: { left: Math.PI / 5, right: Math.PI / 5 },
    thumbAxis: { left: null, right: null },
    fingerBones: {},
    armHelpers: { left: [], right: [] },
    eyeSource: 'bothEyes',
    physicsOwned: ['髪1'],
    physicsWithBoneOwned: [],
    waistCancel: true,
  },
  director: {
    stance: 'sit',
    sinceMs: 12_500,
    nowMs: 40_000,
    stanceReason: 'idle-timeout',
    reason: 'approach-chat',
    goalX: 22.5,
    pace: 'walk',
    pendingGoal: null,
    nextWanderAtMs: null,
    moveRefractoryUntilMs: 0,
    lookRefractoryUntilMs: 0,
    lastToolSeq: 0,
    toolRefused: false,
    toolRetryAfterMs: null,
    performing: null,
    lastActionSeq: 0,
    actionRefusal: null,
    actionRetryAfterMs: null,
    toolRefusalReason: null,
    clockOffsetMs: 60_000,
    centerY: -6.512,
  },
  lookAt: { target: { x: 0.5, y: 1.25, z: -2 }, yaw: Math.PI / 6, pitch: -Math.PI / 36, turning: true, turns: 3 },
  feet: { maxError: 0.0312, errorL: 0.0312, errorR: 0.0104, contact: 0.95 },
  touch: { lastRegion: 'head', hitBody: true, petActive: false, headScreenPoint: { x: 320.4, y: 180.6 }, events: 7 },
  world: { unitsPerDip: 0.05, floorRowDip: 892, ground: { minX: -60.25, maxX: 60.25 }, homeX: 35.713, characterHeightDip: 300, originX: 0, reach: null },
  characterPlacement: { x: 507.25, y: 592.5, width: 84.5, height: 300.4 },
  stageModel: { height: 15.02, footBaselineY: 0.731 },
  locomotion: { mode: 'walking', position: { x: 12.5, z: 0 }, yaw: Math.PI / 2, goalX: 22.5, reason: 'approach-chat', pace: 'walk', speed: 1.234, phase: 0.42, weight: 1, skate: 0.0123, leashClamps: 2, enabled: true },
  arms: { weight: 0.75, owned: { leftArm: 0.25, rightArm: 0, leftFingers: 0.25, rightFingers: 0 }, penetration: { left: 0, right: 0.0456 }, clothContact: { left: 0.1, right: 0 }, hangDeg: 72, handBelowHip: true },
}

async function renderLab() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const screen = await render(MMDMotionDevtools, {
    global: { plugins: [pinia, createTestI18n()] },
  })
  return { screen, pinia, diagnostics: useMMDMotionDiagnostics() }
}

describe('mmd motion lab', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the rig report, director, body readouts and timings from a fixture snapshot', async () => {
    const { screen, diagnostics } = await renderLab()
    const { t } = createTestI18n().global
    expect(t(`${prefix}.rig.rows.leg-ik-left`)).toBe('Left leg IK')

    await expect.element(screen.getByTestId('mmd-rig')).toHaveTextContent(t(`${prefix}.rig.empty`))
    await expect.element(screen.getByTestId('mmd-director')).toHaveTextContent(t(`${prefix}.director.empty`))

    diagnostics.measure('pose:natural', () => {})
    diagnostics.recordFrame(1 / 60)
    diagnostics.publish(fixture)

    await expect.element(screen.getByTestId('readout-leg-ik-left')).toHaveTextContent('左足ＩＫ -> 左足首 (左ひざ)')
    await expect.element(screen.getByTestId('readout-missing')).toHaveTextContent('rightUpperLeg')
    await expect.element(screen.getByTestId('readout-knee')).toHaveTextContent('+1 (limit)')
    await expect.element(screen.getByTestId('readout-foot-baseline')).toHaveTextContent('0.731')
    await expect.element(screen.getByTestId('readout-rest-arm')).toHaveTextContent('36.0 deg')
    await expect.element(screen.getByTestId('mmd-rig-bones')).toHaveTextContent('leftLowerLeg')
    await expect.element(screen.getByTestId('mmd-rig-bones')).toHaveTextContent('左ひざ')

    await expect.element(screen.getByTestId('readout-stance')).toHaveTextContent('sit')
    await expect.element(screen.getByTestId('readout-since')).toHaveTextContent('12.5 s')
    await expect.element(screen.getByTestId('mmd-director').getByTestId('readout-reason')).toHaveTextContent('idle-timeout')
    await expect.element(screen.getByTestId('readout-clock-offset')).toHaveTextContent('60.0 s')
    await expect.element(screen.getByTestId('readout-center-y')).toHaveTextContent('-6.512')

    await expect.element(screen.getByTestId('readout-target')).toHaveTextContent('0.50, 1.25, -2.00')
    await expect.element(screen.getByTestId('mmd-look-at').getByTestId('readout-yaw')).toHaveTextContent('30.0 deg')
    await expect.element(screen.getByTestId('readout-turning')).toHaveTextContent(t(`${prefix}.body.look-at.turning`))
    await expect.element(screen.getByTestId('readout-max-error')).toHaveTextContent('0.0312')
    await expect.element(screen.getByTestId('readout-contact')).toHaveTextContent('0.95')
    await expect.element(screen.getByTestId('readout-last-region')).toHaveTextContent('head')
    await expect.element(screen.getByTestId('readout-head-screen-point')).toHaveTextContent('320, 181')

    await expect.element(screen.getByTestId('mmd-timings-model')).toHaveTextContent('vivian-fixture')
    await expect.element(screen.getByTestId('mmd-timings-driver')).toHaveTextContent('natural')
    await expect.element(screen.getByTestId('mmd-timings')).toHaveTextContent('pose:natural')
  })

  it('sends overlay toggles to the stage over the eventa contract and turns them back off', async () => {
    const stagePinia = createPinia()
    setActivePinia(stagePinia)
    const stage = useMMDMotionDiagnostics()
    const { screen, diagnostics } = await renderLab()
    expect(diagnostics).not.toBe(stage)

    const ikOn = until(() => stage.overlays.ik).toBe(true, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-overlay-ik').getByRole('switch').click()
    await ikOn
    const collidersOn = until(() => stage.overlays.colliders).toBe(true, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-overlay-colliders').getByRole('switch').click()
    await collidersOn
    expect(stage.overlays).toEqual({ ...mmdOverlaysOff, ik: true, colliders: true })
    await expect.element(screen.getByTestId('mmd-overlay-ik').getByRole('switch')).toBeChecked()

    const ikOff = until(() => stage.overlays.ik).toBe(false, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-overlay-ik').getByRole('switch').click()
    await ikOff
    expect(stage.overlays).toEqual({ ...mmdOverlaysOff, colliders: true })

    const goalOn = until(() => stage.overlays.goal).toBe(true, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-overlay-goal').getByRole('switch').click()
    await goalOn
    expect(stage.overlays).toEqual({ ...mmdOverlaysOff, colliders: true, goal: true })
    await expect.element(screen.getByTestId('mmd-overlay-ik').getByRole('switch')).not.toBeChecked()
    disposePinia(stagePinia)
  })

  it('shows the world, locomotion and arm cards from a fixture snapshot', async () => {
    const { screen, diagnostics } = await renderLab()
    const { t } = createTestI18n().global
    await expect.element(screen.getByTestId('mmd-world')).toHaveTextContent(t(`${prefix}.world.empty`))
    await expect.element(screen.getByTestId('mmd-locomotion')).toHaveTextContent(t(`${prefix}.locomotion.empty`))
    await expect.element(screen.getByTestId('mmd-arms')).toHaveTextContent(t(`${prefix}.arms.empty`))
    await expect.element(screen.getByTestId('mmd-locomotion-walk')).toBeDisabled()

    diagnostics.publish(fixture)

    const world = screen.getByTestId('mmd-world')
    await expect.element(world.getByTestId('readout-units-per-dip')).toHaveTextContent('0.05000')
    await expect.element(world.getByTestId('readout-floor-row')).toHaveTextContent('892.0 DIP')
    await expect.element(world.getByTestId('readout-ground')).toHaveTextContent('-60.25 .. 60.25')
    await expect.element(world.getByTestId('readout-home-x')).toHaveTextContent('35.713')
    await expect.element(world.getByTestId('readout-character-height')).toHaveTextContent('300.0 DIP')
    await expect.element(world.getByTestId('readout-model-height')).toHaveTextContent('15.020 / 0.731')
    await expect.element(world.getByTestId('readout-placement')).toHaveTextContent('507.3, 592.5 84.5 x 300.4')

    const locomotion = screen.getByTestId('mmd-locomotion')
    await expect.element(locomotion.getByTestId('readout-mode')).toHaveTextContent('walking')
    await expect.element(locomotion.getByTestId('readout-position')).toHaveTextContent('12.500, 0.000')
    await expect.element(locomotion.getByTestId('readout-yaw')).toHaveTextContent('90.0 deg')
    await expect.element(locomotion.getByTestId('readout-goal')).toHaveTextContent('22.500')
    await expect.element(locomotion.getByTestId('readout-reason')).toHaveTextContent('approach-chat')
    await expect.element(locomotion.getByTestId('readout-pace')).toHaveTextContent('walk')
    await expect.element(locomotion.getByTestId('readout-speed')).toHaveTextContent('1.234')
    await expect.element(locomotion.getByTestId('readout-phase')).toHaveTextContent('0.42')
    await expect.element(locomotion.getByTestId('readout-skate')).toHaveTextContent('0.0123')
    await expect.element(locomotion.getByTestId('readout-leash-clamps')).toHaveTextContent('2')
    await expect.element(locomotion.getByTestId('readout-enabled')).toHaveTextContent(t(`${prefix}.locomotion.yes`))

    const arms = screen.getByTestId('mmd-arms')
    await expect.element(arms.getByTestId('readout-weight')).toHaveTextContent('0.75')
    await expect.element(arms.getByTestId('readout-owned-left-arm')).toHaveTextContent('0.25')
    await expect.element(arms.getByTestId('readout-penetration-right')).toHaveTextContent('0.0456')
    await expect.element(arms.getByTestId('readout-cloth-contact-left')).toHaveTextContent('0.1000')
    await expect.element(arms.getByTestId('readout-hang')).toHaveTextContent('72.0 deg')
    await expect.element(arms.getByTestId('readout-hand-below-hip')).toHaveTextContent(t(`${prefix}.arms.yes`))
  })

  it('posts a walk goal, a home and a roam mode to the stage from the locomotion card', async () => {
    const stagePinia = createPinia()
    setActivePinia(stagePinia)
    const stage = useMMDMotionDiagnostics()
    const { screen } = await renderLab()
    stage.publish(fixture)

    const walked = until(() => stage.goalRequest).toMatch(request => request !== null, { timeout: 5000, throwOnTimeout: true })
    await expect.element(screen.getByTestId('mmd-locomotion-walk')).toBeEnabled()
    await screen.getByTestId('mmd-locomotion-walk').click()
    await walked
    expect(stage.goalRequest).toEqual({ seq: 1, x: 12.5 + 400 * 0.05, pace: 'walk' })

    const homed = until(() => stage.homeX).toBe(12.5, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-locomotion-set-home').click()
    await homed

    const roaming = until(() => stage.roamModeRequest?.mode).toBe('roam', { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-locomotion-roam').getByRole('switch').click()
    await roaming
    expect(stage.roamModeRequest).toEqual({ seq: 1, mode: 'roam' })

    await screen.getByTestId('mmd-locomotion-walk-dip').getByRole('spinbutton').fill('')
    await expect.element(screen.getByTestId('mmd-locomotion-walk')).toBeDisabled()
    disposePinia(stagePinia)
  })

  it('walks by the typed offset from the locomotion card', async () => {
    const stagePinia = createPinia()
    setActivePinia(stagePinia)
    const stage = useMMDMotionDiagnostics()
    const { screen } = await renderLab()
    stage.publish(fixture)

    await screen.getByTestId('mmd-locomotion-walk-dip').getByRole('spinbutton').fill('-300')
    const walked = until(() => stage.goalRequest).toMatch(request => request !== null, { timeout: 5000, throwOnTimeout: true })
    await expect.element(screen.getByTestId('mmd-locomotion-walk')).toBeEnabled()
    await screen.getByTestId('mmd-locomotion-walk').click()
    await walked
    expect(stage.goalRequest).toEqual({ seq: 1, x: 12.5 + -300 * 0.05, pace: 'walk' })
    disposePinia(stagePinia)
  })

  it('lists the clips with the performing state and ownership, plays and stops a row, and keeps an unusable row unplayable', async () => {
    const stagePinia = createPinia()
    setActivePinia(stagePinia)
    const stage = useMMDMotionDiagnostics()
    const { screen } = await renderLab()
    const { t } = createTestI18n().global
    await expect.element(screen.getByTestId('mmd-clips')).toHaveTextContent(t(`${prefix}.clips.empty`))

    stage.publish({
      ...fixture,
      clips: [
        { name: 'dance-long', kind: 'dance', layer: 'full', loop: false, label: 'dance', exposed: true, downgraded: false, notes: [] },
        { name: 'arms-wave', kind: 'gesture', layer: 'upper', loop: false, label: null, exposed: false, downgraded: true, notes: [] },
        { name: 'empty', kind: 'unusable', layer: 'none', loop: false, label: null, exposed: false, downgraded: false, notes: ['no-animated-bones'] },
      ],
      action: { performing: { name: 'dance-long', layer: 'full', phase: 'playing', seq: 4 }, lastActionSeq: 4, refusal: 'busy', retryAfterMs: 1_500, drops: { unknown: 1, notExposed: 2, notGesture: 0, superseded: 3 } },
      animation: { idle: 'idle', currentAction: null, actionsStarted: 2, layer: { seq: 4, name: 'dance-long', state: 'playing' } },
      ownership: { root: 1, leftLegIk: 1, rightLegIk: 0.5, lowerBody: 0, leftArm: 0.25, rightArm: 0.75, leftFingers: 0, rightFingers: 0, upperBody: 1, head: 0 },
    })

    const dance = screen.getByTestId('mmd-clip-dance-long')
    await expect.element(dance).toHaveTextContent('dance-long')
    await expect.element(dance).toHaveTextContent(t('settings.mmd.animation.clips.kinds.dance'))
    await expect.element(dance).toHaveTextContent(t('settings.mmd.animation.clips.layers.full'))
    await expect.element(screen.getByTestId('mmd-clip-arms-wave')).toHaveTextContent(t('settings.mmd.animation.clips.badges.downgraded'))
    const action = screen.getByTestId('mmd-action')
    await expect.element(action.getByTestId('readout-performing')).toHaveTextContent('dance-long (full, playing, #4)')
    await expect.element(action.getByTestId('readout-refusal')).toHaveTextContent('busy (1.5 s)')
    await expect.element(action.getByTestId('readout-drops')).toHaveTextContent('1 / 2 / 0 / 3')
    await expect.element(action.getByTestId('readout-layer')).toHaveTextContent('dance-long (playing, #4)')
    await expect.element(screen.getByTestId('ownership-legs')).toHaveTextContent('1.00')
    await expect.element(screen.getByTestId('ownership-arms')).toHaveTextContent('0.75')
    await expect.element(screen.getByTestId('ownership-head')).toHaveTextContent('0.00')

    const unusable = screen.getByTestId('mmd-clip-play-empty')
    await expect.element(unusable).toBeDisabled()
    await expect.element(unusable).toHaveAttribute('title', t('settings.mmd.animation.clips.notes.no-animated-bones'))
    await expect.element(screen.getByTestId('mmd-clip-stop-arms-wave')).toBeDisabled()
    expect(stage.clipRequest).toBeNull()

    const played = until(() => stage.clipRequest).toMatch(request => request !== null, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-clip-play-dance-long').click()
    await played
    expect(stage.clipRequest).toEqual({ seq: 1, name: 'dance-long', loop: undefined })

    const stopped = until(() => stage.clipRequest?.seq).toBe(2, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-clip-stop-dance-long').click()
    await stopped
    expect(stage.clipRequest).toEqual({ seq: 2, name: null, loop: undefined })
    disposePinia(stagePinia)
  })

  it('advances the stage director clock by the entered milliseconds', async () => {
    const stagePinia = createPinia()
    setActivePinia(stagePinia)
    const stage = useMMDMotionDiagnostics()
    const { screen } = await renderLab()

    const advanced = until(() => stage.directorClockOffsetMs).toBe(120_000, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-director-advance-ms').getByRole('spinbutton').fill('120000')
    await screen.getByTestId('mmd-director-advance').click()
    await advanced

    await screen.getByTestId('mmd-director-advance-ms').getByRole('spinbutton').fill('-5')
    await expect.element(screen.getByTestId('mmd-director-advance')).toBeDisabled()
    disposePinia(stagePinia)
  })
})
