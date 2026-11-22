import type { ElectronMcpRuntimeStatus } from '../../../../shared/eventa'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import McpSettings from './mcp.vue'

const invokeMocks = vi.hoisted(() => ({
  getRuntimeStatus: vi.fn(),
  listTools: vi.fn(),
  readConfigText: vi.fn(),
}))

vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    const id = event?.receiveEvent?.id ?? ''
    if (id.includes('mcp:get-runtime-status'))
      return invokeMocks.getRuntimeStatus
    if (id.includes('mcp:list-tools'))
      return invokeMocks.listTools
    if (id.includes('mcp:read-config-text'))
      return invokeMocks.readConfigText

    // The page binds its write, restart, and test actions at setup. No test here runs them.
    return () => Promise.reject(new Error(`Unexpected eventa invoke: ${id}`))
  },
}))

// The page reads this store only after a restart. The real store binds the chat
// pipeline and the main process, which this page test does not start.
vi.mock('../../../stores/tools/mcp', () => ({
  useTamagotchiMcpToolsStore: () => ({ refresh: () => Promise.resolve() }),
}))

const configPath = '/home/user/.config/airi/mcp.json'

function runtimeStatus(servers: ElectronMcpRuntimeStatus['servers']): ElectronMcpRuntimeStatus {
  return { path: configPath, servers, updatedAt: 0 }
}

async function renderPage() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const screen = await render(McpSettings, {
    global: {
      plugins: [
        pinia,
        createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }),
      ],
      // The app installs this directive for analytics. It draws nothing.
      directives: { trackButton: {} },
    },
  })
  onTestFinished(() => screen.unmount())
  return screen
}

describe('mcpSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    invokeMocks.listTools.mockResolvedValue([])
    invokeMocks.readConfigText.mockResolvedValue({ path: configPath, text: '{"mcpServers":{}}' })
  })

  it('labels the Terminal switch and reports that the server is not loaded', async () => {
    invokeMocks.getRuntimeStatus.mockResolvedValue(runtimeStatus([]))

    await renderPage()

    await expect.element(page.getByText('Bundled Terminal', { exact: true })).toBeVisible()
    const terminalSwitch = page.getByRole('switch', { name: 'Bundled Terminal' })
    await expect.element(terminalSwitch).toBeVisible()
    // The status pill sits outside the switch's label, so its text is not part of the switch's name.
    await expect.element(terminalSwitch).not.toHaveAccessibleName(/not loaded/)
    await expect.element(page.getByTestId('terminal-connection-status')).toHaveTextContent('not loaded')
  })

  it('reports a running Terminal server as connected', async () => {
    invokeMocks.getRuntimeStatus.mockResolvedValue(runtimeStatus([
      { name: 'airi-terminal', state: 'running', transport: 'stdio', command: 'airi-terminal', args: [], pid: 4242 },
    ]))

    await renderPage()

    await expect.element(page.getByTestId('terminal-connection-status')).toHaveTextContent('connected')
  })
})
