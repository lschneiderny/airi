import type { BrowserWindow, Rectangle } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { GodotStageManager } from '../../../services/airi/godot-stage'
import type { IOTraceRecordingService } from '../../../services/airi/io-trace-recording'
import type { McpManager } from '../../../services/airi/mcp-servers'
import type { PerfRecordingService } from '../../../services/airi/perf-recording'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { GlobalShortcutService } from '../../../services/electron/global-shortcut'
import type { ChatWindowManager } from '../../chat'
import type { ControlsMenuWindowManager } from '../../controls-menu'
import type { EditorWindowManager } from '../../editor'
import type { NoticeWindowManager } from '../../notice'
import type { OnboardingWindowManager } from '../../onboarding'
import type { SettingsWindowManager } from '../../settings'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronCenterMainWindow,
  electronChatAttentionTargetChanged,
  electronChatButtonStateChanged,
  electronControlsMenuOpen,
  electronGetChatAttentionTarget,
  electronGetChatButtonState,
  electronMainPageMounted,
  electronOpenChat,
  electronOpenEditor,
  electronOpenInlay,
  electronOpenMainDevtools,
  electronOpenSettings,
  noticeWindowEventa,
} from '../../../../shared/eventa'
import { onWindowClosed } from '../../../libs/electron/on-window-closed'
import { createWindowContext } from '../../../libs/electron/window-context'
import { createGodotStageService } from '../../../services/airi/godot-stage'
import { registerIOTraceRecording } from '../../../services/airi/io-trace-recording/register'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createOnboardingService } from '../../../services/airi/onboarding'
import { registerPerfRecording } from '../../../services/airi/perf-recording/register'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupMainWindowElectronInvokes(params: {
  window: BrowserWindow
  /** The app menu of the controls island. It opens in its own window, so it can extend past this one. */
  controlsMenu: ControlsMenuWindowManager
  editorWindow: EditorWindowManager
  settingsWindow: SettingsWindowManager
  chatWindow: ChatWindowManager
  widgetsManager: WidgetsWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  serverChannel: ServerChannel
  godotStageManager: GodotStageManager
  mcpManager: McpManager
  i18n: I18n
  onboardingWindowManager: OnboardingWindowManager
  ioTraceRecording: IOTraceRecordingService
  perfRecording: PerfRecordingService
  inlayWindow: () => Promise<BrowserWindow>
  globalShortcut: GlobalShortcutService
  /** Owns the main window's pin, which fullscreen mode overrides. */
  setPinned: (pinned: boolean) => void
  /** Centers the main window on its display, and returns its new bounds. Fullscreen mode centers the bounds it returns to. */
  center: () => Rectangle
}) {
  const { context } = createWindowContext(params.window)

  await setupBaseWindowElectronInvokes({
    context,
    window: params.window,
    serverChannel: params.serverChannel,
    i18n: params.i18n,
    setAlwaysOnTop: params.setPinned,
    getSidecarPid: () => params.godotStageManager.getStatus().pid,
  })
  // The stage renderer owns the voice host, so it registers the Push to Talk hold shortcut and receives its key events.
  params.globalShortcut.registerWindow({ context, window: params.window })
  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createAutoUpdaterService({ context, window: params.window, service: params.autoUpdater })
  defineInvokeHandler(context, electronMainPageMounted, () => params.autoUpdater.markMainPageMounted())
  createMcpServersService({ context, manager: params.mcpManager })
  createGodotStageService({ context, manager: params.godotStageManager, window: params.window })
  createOnboardingService({ context, onboardingWindowManager: params.onboardingWindowManager, mainWindow: params.window })
  const stopIOTraceRecording = registerIOTraceRecording(context, params.ioTraceRecording)
  onWindowClosed(params.window, stopIOTraceRecording)
  const stopPerfRecording = registerPerfRecording(context, params.window, params.perfRecording)
  onWindowClosed(params.window, stopPerfRecording)

  defineInvokeHandler(context, electronCenterMainWindow, () => params.center())
  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenEditor, () => params.editorWindow.openWindow())
  // Speech opens the inlay without focus, so the user can keep working in another app while speaking.
  defineInvokeHandler(context, electronOpenInlay, async () => {
    const inlay = await params.inlayWindow()
    if (!inlay.isDestroyed() && !inlay.isVisible())
      inlay.showInactive()
  })
  defineInvokeHandler(context, electronOpenSettings, payload => params.settingsWindow.openWindow(payload?.route))
  defineInvokeHandler(context, electronOpenChat, () => params.chatWindow.toggle())
  defineInvokeHandler(context, electronGetChatButtonState, () => params.chatWindow.getButtonState())
  const stopChatButtonState = params.chatWindow.onButtonStateChange(state => context.emit(electronChatButtonStateChanged, state))
  onWindowClosed(params.window, stopChatButtonState)
  defineInvokeHandler(context, electronGetChatAttentionTarget, () => params.chatWindow.getAttentionTarget())
  const stopChatAttentionTarget = params.chatWindow.onAttentionTargetChange(target => context.emit(electronChatAttentionTargetChanged, target))
  onWindowClosed(params.window, stopChatAttentionTarget)
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))
  defineInvokeHandler(context, electronControlsMenuOpen, request => params.controlsMenu.open(request))
}
