import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCharacterNotebookStore } from './notebook'

describe('notebook reminder occurrences', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    setActivePinia(createPinia())
  })

  afterEach(() => vi.useRealTimers())

  it('uses creation time for undated tasks and leaves the occurrence stable on delivery', () => {
    const notebook = useCharacterNotebookStore()
    const task = notebook.scheduleTask({ title: 'Take a break' })
    const born = task.createdAt
    notebook.markTaskNotified(task.id, born + 30_000)
    vi.setSystemTime(born + 30_000)
    expect(notebook.getDueTasks(Date.now(), 0)).toHaveLength(1)
    expect(task.createdAt).toBe(born)
    expect(task.firstNotifiedAt).toBe(born)
    expect(task.revision).toBe(0)
  })

  it('consumes every outcome until an explicit reschedule creates a new occurrence', () => {
    const notebook = useCharacterNotebookStore()
    const task = notebook.scheduleTask({ title: 'Take a break' })
    notebook.addressTask(task.id, task.revision)
    notebook.markTaskNotified(task.id)
    expect(notebook.getDueTasks(Date.now(), 60_000)).toEqual([])
    vi.setSystemTime(task.createdAt + 30_000)
    notebook.requeueTask(task.id, { dueAt: Date.now() })
    expect(task.revision).toBe(1)
    expect(task.firstNotifiedAt).toBeUndefined()
    notebook.addressTask(task.id, 0)
    expect(notebook.getDueTasks(Date.now(), 0)).toHaveLength(1)
    notebook.markTaskDone(task.id)
    expect(notebook.getDueTasks(Date.now(), 0)).toEqual([])
  })
})
