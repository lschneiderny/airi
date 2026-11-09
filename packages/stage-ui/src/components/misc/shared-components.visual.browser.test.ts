import { Button, Callout, Checkbox, Input } from '@proj-airi/ui'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import Alert from './alert.vue'

import { renderVisualBaseline } from '../../test/visual-baseline'

// Icons must exist in the first stylesheet. This one is in the UnoCSS safelist (`safelistSettingsEntryIcons`).
const icon = 'i-solar:leaf-bold-duotone'

describe('shared component visual baselines', () => {
  it('button colors, shapes, sizes, and states', async (context) => {
    const frame = await renderVisualBaseline(context, () => [
      h(Button, { label: 'Secondary' }),
      h(Button, { label: 'Primary', variant: 'primary' }),
      h(Button, { label: 'Accent', color: 'primary', variant: 'primary' }),
      h(Button, { label: 'Subtle', color: 'primary' }),
      h(Button, { label: 'Delete', color: 'red', variant: 'primary', icon }),
      h(Button, { label: 'Rounded', shape: 'rounded', size: 'sm' }),
      h(Button, { label: 'Skewed', shape: 'parallelogram', color: 'cyan', variant: 'primary' }),
      h(Button, { 'shape': 'circle', icon, 'aria-label': 'Leaf' }),
      h(Button, { label: 'Large', size: 'lg' }),
      h(Button, { label: 'Disabled', disabled: true }),
    ], { layout: 'wrap' })

    await expect.element(frame).toMatchScreenshot('button')
  })

  it('callout themes', async (context) => {
    const frame = await renderVisualBaseline(context, () => (['primary', 'violet', 'lime', 'orange'] as const).map(theme =>
      h(Callout, { theme, label: `${theme} callout` }, () => 'Short explanatory text below the label.'),
    ))

    await expect.element(frame).toMatchScreenshot('callout')
  })

  it('checkbox switch states', async (context) => {
    const frame = await renderVisualBaseline(context, () => [
      h(Checkbox, { 'modelValue': false, 'aria-label': 'Off' }),
      h(Checkbox, { 'modelValue': true, 'aria-label': 'On' }),
      h(Checkbox, { 'modelValue': false, 'disabled': true, 'aria-label': 'Off, disabled' }),
      h(Checkbox, { 'modelValue': true, 'disabled': true, 'aria-label': 'On, disabled' }),
    ], { layout: 'wrap' })

    await expect.element(frame).toMatchScreenshot('checkbox')
  })

  it('input variants and states', async (context) => {
    const frame = await renderVisualBaseline(context, () => [
      h(Input, { modelValue: 'Entered value' }),
      h(Input, { modelValue: '', placeholder: 'Placeholder text' }),
      h(Input, { modelValue: 'Dimmed variant', variant: 'primary-dimmed' }),
      h(Input, { modelValue: 'Disabled', disabled: true }),
    ])

    await expect.element(frame).toMatchScreenshot('input')
  })

  it('alert tones', async (context) => {
    // The loading tone is left out: its spinner icon animates.
    const frame = await renderVisualBaseline(context, () => (['error', 'warning', 'success', 'info'] as const).map(type =>
      h(Alert, { type }, {
        title: () => `${type} title`,
        content: () => 'Context for the current operation.',
      }),
    ))

    await expect.element(frame).toMatchScreenshot('alert')
  })
})
