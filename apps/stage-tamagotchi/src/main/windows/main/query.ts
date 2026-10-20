/**
 * Builds the query the main window's renderer reads before Pinia starts.
 *
 * `motion-qa-bridge=true` enables the dev-only motion QA bridge. It needs a development build,
 * `APP_MOTION_QA_BRIDGE=true`, and `APP_REMOTE_DEBUG=true`, because remote debug is the bridge's only client.
 *
 * @example
 * mainWindowQuery(true, { APP_MOTION_QA_BRIDGE: 'true', APP_REMOTE_DEBUG: 'true' })
 * // => { 'synced-leader': 'true', 'motion-qa-bridge': 'true' }
 */
export function mainWindowQuery(dev: boolean, environment: Record<string, string | undefined>): Record<string, string> {
  const query: Record<string, string> = { 'synced-leader': 'true' }
  if (dev && /^true$/i.test(environment.APP_MOTION_QA_BRIDGE ?? '') && /^true$/i.test(environment.APP_REMOTE_DEBUG ?? ''))
    query['motion-qa-bridge'] = 'true'
  return query
}
