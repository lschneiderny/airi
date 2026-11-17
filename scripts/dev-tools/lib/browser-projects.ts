import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The root Vitest config that holds every browser project. Its project list is the only list of them. */
export const browserRootConfig = 'vitest.browser.config.ts'

export interface BrowserTestProject {
  /** The Vitest project name, such as `stage-ui:browser`. */
  name: string
  /** The workspace package directory that owns the project, relative to the root with `/`. */
  packagePath: string
}

/**
 * Reads the browser projects from the source of `vitest.browser.config.ts`, in config order. Each entry
 * `{ project: x, name: 'n' }` is joined to the `import { x } from './<package>/vitest.browser-project.ts'` that names its
 * package, so the scripts that run browser projects need no copy of the list and do not load Vite to read it.
 */
export function parseBrowserTestProjects(source: string): BrowserTestProject[] {
  const packages = new Map([...source.matchAll(/import \{[^}]*\b(\w+BrowserProject)\b[^}]*\} from '\.\/(.+)\/vitest\.browser-project\.ts'/g)].map(match => [match[1], match[2]]))
  const projects = [...source.matchAll(/\{ project: (\w+), name: '([^']+)' \}/g)].map(([, project, name]) => {
    const packagePath = packages.get(project)
    if (!packagePath)
      throw new Error(`${browserRootConfig}: ${project} is not imported from a package's vitest.browser-project.ts`)
    return { name, packagePath }
  })
  if (!projects.length)
    throw new Error(`${browserRootConfig}: no { project, name } entries found`)
  return projects
}

export function readBrowserTestProjects(root: string): BrowserTestProject[] {
  return parseBrowserTestProjects(readFileSync(join(root, browserRootConfig), 'utf8'))
}
