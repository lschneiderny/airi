/** Optional vendor metadata is untrusted; malformed records do not hide valid names. */
export function readParameterDisplayNames(displayInfo: unknown): Map<string, string> {
  const names = new Map<string, string>()
  if (!displayInfo || typeof displayInfo !== 'object' || !('Parameters' in displayInfo) || !Array.isArray(displayInfo.Parameters))
    return names
  for (const parameter of displayInfo.Parameters) {
    if (parameter && typeof parameter === 'object'
      && 'Id' in parameter && typeof parameter.Id === 'string'
      && 'Name' in parameter && typeof parameter.Name === 'string') {
      names.set(parameter.Id, parameter.Name)
    }
  }
  return names
}
