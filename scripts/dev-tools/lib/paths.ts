import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Whether `child` is `parent` or lies below it. `/tmpfoo` is not inside `/tmp`; a path on another Windows drive never is. */
export function isPathInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}
