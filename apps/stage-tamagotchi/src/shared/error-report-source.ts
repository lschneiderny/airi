/** Where a build sends its error reports. `electron.vite.config.ts` is the only reader of the build environment. */
export interface ErrorReportSource {
  /** The Sentry DSN that main sends reports to. Absent in a build that sends no error reports. */
  dsn: string | undefined
  /** The Sentry account that gets the source maps of the build. Absent in a build that makes and uploads none. */
  sourceMapUpload: { org: string, project: string, authToken: string } | undefined
}

/**
 * Returns the error report source of a build. A fork build never reports to upstream's Sentry projects, so no DSN,
 * organization, or project is built in:
 *
 * - Error reports are off unless the build sets its own `AIRI_ERROR_REPORT_DSN`. A build with a DSN still sends
 *   only when it enables analytics (`VITE_ENABLE_ANALYTICS`) and the user turned the analytics setting on.
 * - Source maps are made and uploaded only with a DSN and all of `AIRI_SENTRY_ORG`, `AIRI_SENTRY_PROJECT`, and
 *   `SENTRY_AUTH_TOKEN`.
 */
export function errorReportSourceFromEnv(env: Record<string, string | undefined>): ErrorReportSource {
  const dsn = env.AIRI_ERROR_REPORT_DSN || undefined
  const org = env.AIRI_SENTRY_ORG
  const project = env.AIRI_SENTRY_PROJECT
  const authToken = env.SENTRY_AUTH_TOKEN
  if (!dsn || !org || !project || !authToken)
    return { dsn, sourceMapUpload: undefined }

  return { dsn, sourceMapUpload: { org, project, authToken } }
}
