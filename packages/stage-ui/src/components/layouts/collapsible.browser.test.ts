import { Collapsible } from '@proj-airi/ui'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'

function renderCollapsible(content: () => ReturnType<typeof h>[]) {
  const open = shallowRef(true)
  const screen = render(defineComponent({
    render: () => h(Collapsible, {
      'label': 'Details',
      'modelValue': open.value,
      'onUpdate:modelValue': (value: boolean) => open.value = value,
    }, () => content()),
  // The app runs Vue's real `Transition`, which keeps one child; the default stub would pass any number through.
  }), { global: { stubs: { transition: false } } })
  return { screen, open }
}

function renderedChildren(container: HTMLElement) {
  return container.querySelectorAll('[data-testid^="child-"]').length
}

describe('collapsible', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders every root of a two-root slot when open', async () => {
    const { screen } = renderCollapsible(() => [
      h('p', { 'data-testid': 'child-a' }, 'A'),
      h('p', { 'data-testid': 'child-b' }, 'B'),
    ])

    await expect.element(page.getByTestId('child-a')).toBeInTheDocument()
    expect(renderedChildren(screen.container)).toBe(2)
  })

  it('renders every row of a v-for slot when open', async () => {
    const { screen } = renderCollapsible(() => ['a', 'b', 'c'].map(key => h('p', { 'key': key, 'data-testid': `child-${key}` }, key)))

    await expect.element(page.getByTestId('child-a')).toBeInTheDocument()
    expect(renderedChildren(screen.container)).toBe(3)
  })

  it('removes the content after the leave transition when closed', async () => {
    const { open } = renderCollapsible(() => [
      h('p', { 'data-testid': 'child-a' }, 'A'),
      h('p', { 'data-testid': 'child-b' }, 'B'),
    ])
    await expect.element(page.getByTestId('child-a')).toBeInTheDocument()

    open.value = false

    await expect.element(page.getByTestId('child-a'), { timeout: 2000 }).not.toBeInTheDocument()
    await expect.element(page.getByTestId('child-b'), { timeout: 2000 }).not.toBeInTheDocument()
  })
})
