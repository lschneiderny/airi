import type { MMDMotionSnapshot } from '@proj-airi/stage-ui-mmd/stores'

import en from '@proj-airi/i18n/locales/en'

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
    eyeSource: 'bothEyes',
    physicsOwned: ['髪1'],
    physicsWithBoneOwned: [],
    waistCancel: true,
  },
  director: { stance: 'sit', sinceMs: 12_500, reason: 'idle-timeout', clockOffsetMs: 60_000, centerY: -6.512 },
  lookAt: { target: { x: 0.5, y: 1.25, z: -2 }, yaw: Math.PI / 6, pitch: -Math.PI / 36, turning: true, turns: 3 },
  feet: { maxError: 0.0312, errorL: 0.0312, errorR: 0.0104, contact: 0.95 },
  touch: { lastRegion: 'head', hitBody: true, petActive: false, headScreenPoint: { x: 320.4, y: 180.6 }, events: 7 },
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
    await expect.element(screen.getByTestId('readout-clock-offset')).toHaveTextContent('60.0 s')
    await expect.element(screen.getByTestId('readout-center-y')).toHaveTextContent('-6.512')

    await expect.element(screen.getByTestId('readout-target')).toHaveTextContent('0.50, 1.25, -2.00')
    await expect.element(screen.getByTestId('readout-yaw')).toHaveTextContent('30.0 deg')
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
    expect(stage.overlays).toEqual({ ik: true, colliders: true, feet: false, lookAt: false })
    await expect.element(screen.getByTestId('mmd-overlay-ik').getByRole('switch')).toBeChecked()

    const ikOff = until(() => stage.overlays.ik).toBe(false, { timeout: 5000, throwOnTimeout: true })
    await screen.getByTestId('mmd-overlay-ik').getByRole('switch').click()
    await ikOff
    expect(stage.overlays).toEqual({ ik: false, colliders: true, feet: false, lookAt: false })
    await expect.element(screen.getByTestId('mmd-overlay-ik').getByRole('switch')).not.toBeChecked()
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
