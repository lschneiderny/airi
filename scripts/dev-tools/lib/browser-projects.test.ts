import { describe, expect, it } from 'vitest'

import { parseBrowserTestProjects } from './browser-projects'

describe('parseBrowserTestProjects', () => {
  it('joins each project entry to the package its browser project is imported from, in config order', () => {
    const source = [
      `import { stageUiBrowserProject } from './packages/stage-ui/vitest.browser-project.ts'`,
      `import { stageTamagotchiBrowserProject } from './apps/stage-tamagotchi/vitest.browser-project.ts'`,
      `projects: [`,
      `  { project: stageTamagotchiBrowserProject, name: 'stage-tamagotchi:browser' },`,
      `  { project: stageUiBrowserProject, name: 'stage-ui:browser' },`,
      `]`,
    ].join('\n')

    expect(parseBrowserTestProjects(source)).toEqual([
      { name: 'stage-tamagotchi:browser', packagePath: 'apps/stage-tamagotchi' },
      { name: 'stage-ui:browser', packagePath: 'packages/stage-ui' },
    ])
  })

  it('fails when an entry has no package import or the config lists no project', () => {
    expect(() => parseBrowserTestProjects(`{ project: strayBrowserProject, name: 'stray:browser' }`)).toThrow('strayBrowserProject is not imported')
    expect(() => parseBrowserTestProjects('')).toThrow('no { project, name } entries')
  })
})
