<script setup lang="ts">
import type { DataSettingsStatusTone } from '@proj-airi/stage-pages/pages/settings/data/status'
import type { ChatSessionsExport } from '@proj-airi/stage-ui/types/chat-session'
import type { AlertTone } from '@proj-airi/ui'

import ChatsSection from '@proj-airi/stage-pages/pages/settings/data/components/chats-section.vue'
import DangerSection from '@proj-airi/stage-pages/pages/settings/data/components/danger-section.vue'
import DownloadedModelsSection from '@proj-airi/stage-pages/pages/settings/data/components/downloaded-models-section.vue'
import ModelsModulesSection from '@proj-airi/stage-pages/pages/settings/data/components/models-modules-section.vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { createDataSettingsStatusState } from '@proj-airi/stage-pages/pages/settings/data/status'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { Alert } from '@proj-airi/ui'
import { computed } from 'vue'

import DesktopFolderSection from './components/desktop-folder-section.vue'
import DesktopResetSection from './components/desktop-reset-section.vue'

import { homeAssistantSetConfig } from '../../../../shared/eventa/home-assistant'
import { storedDataDeleteActivity } from '../../../../shared/eventa/stored-data'

const { statusMessage, statusTone, handleStatus } = createDataSettingsStatusState()
const chatSession = useChatSessionStore()
const setHomeAssistantConfig = useElectronEventaInvoke(homeAssistantSetConfig)
const deleteActivityRecords = useElectronEventaInvoke(storedDataDeleteActivity)

/** The main process owns these: the Home Assistant address and token, session logs, IO traces, computer-use captures. */
async function deleteMainProcessData() {
  // An empty address clears the stored token with it.
  await setHomeAssistantConfig({ baseUrl: '' })
  await deleteActivityRecords()
}

const statusAlertTones: Record<DataSettingsStatusTone, AlertTone> = {
  success: 'success',
  error: 'danger',
  neutral: 'info',
}
const statusAlertTone = computed(() => statusAlertTones[statusTone.value])

async function syncImportedChats(payload: ChatSessionsExport) {
  await chatSession.importSessions(payload)
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-4']">
    <Alert v-if="statusMessage" :tone="statusAlertTone" live="polite">
      {{ statusMessage }}
    </Alert>
    <DesktopFolderSection @status="handleStatus" />
    <ChatsSection :sync-imported-chats="syncImportedChats" @status="handleStatus" />
    <DownloadedModelsSection @status="handleStatus" />
    <ModelsModulesSection @status="handleStatus" />
    <DesktopResetSection @status="handleStatus" />
    <DangerSection :delete-host-data="deleteMainProcessData" @status="handleStatus" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.data.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.data.description
  icon: i-solar:database-bold-duotone
  settingsEntry: true
  order: 7
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
