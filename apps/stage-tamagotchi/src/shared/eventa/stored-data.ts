import { defineInvokeEventa } from '@moeru/eventa'

/**
 * Deletes the records the main process keeps of what the user and the character did: session logs, IO traces, and
 * computer-use captures. Settings files stay; each owner resets its own through its own contract.
 * Resolves once the files are gone. Recording that is switched on continues into new files.
 */
export const storedDataDeleteActivity = defineInvokeEventa<void>('eventa:invoke:stored-data:delete-activity')
