import { describe, expect, it } from 'vitest'

import { windowLabelFromUrl } from './window-label'

describe('windowLabelFromUrl', () => {
  it.each([
    ['http://localhost:5173/?synced-leader=true#/', 'stage-main'],
    ['file:///opt/airi/renderer/index.html#/', 'stage-main'],
    ['http://localhost:5173/#/?stage-runtime=full', 'stage-main'],
    ['http://localhost:5173/#/stage', 'stage'],
    ['file:///opt/airi/renderer/index.html#/stage?x=1', 'stage'],
    ['http://localhost:5173/#/chat', 'chat'],
    ['http://localhost:5173/#/chat-floating', 'chat'],
    ['http://localhost:5173/#/settings', 'settings'],
    ['http://localhost:5173/#/settings/system/developer', 'settings'],
    ['http://localhost:5173/#/devtools/performance-visualizer', 'devtools'],
    ['http://localhost:5173/#/widgets?id=clock', 'widgets'],
    ['http://localhost:5173/#/stage-preview', 'other'],
    ['http://localhost:5173/#/notice/fade-on-hover', 'other'],
    ['http://localhost:5173/', 'other'],
    ['devtools://devtools/bundled/devtools_app.html', 'other'],
    ['', 'other'],
  ])('labels %s as %s', (url, label) => {
    expect(windowLabelFromUrl(url)).toBe(label)
  })
})
