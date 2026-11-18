import { sentryVitePlugin } from '@sentry/bundler-plugins/vite'

// NOTICE:
// Node loads this file from the Vite configs without a bundler, and Node does not resolve extensionless relative
// imports. So this file imports nothing relative and keeps its own copy of the build-time values.
// Source: `ERR_MODULE_NOT_FOUND` for `./sentry` when `apps/stage-web/vite.config.ts` loaded this file.
// Removal condition: when the Vite configs load through a bundler that resolves extensionless imports.

/**
 * Uploads the source maps of one Vite build to a Sentry project. Put it after all other plugins.
 *
 * Fork departure from upstream: no organization or project is built in, so a build never uploads to upstream's
 * Sentry account. The app passes `upload` only when its build sets its own credentials. Without it, the plugin does
 * nothing.
 */
export function sentrySourceMaps(options: {
  upload: { org: string, project: string, authToken: string } | undefined
  /** Deletes the uploaded maps, for a build that must not ship them. */
  filesToDeleteAfterUpload?: string[]
}) {
  return sentryVitePlugin({
    org: options.upload?.org,
    project: options.upload?.project,
    authToken: options.upload?.authToken,
    disable: !options.upload,
    telemetry: false,
    sourcemaps: { filesToDeleteAfterUpload: options.filesToDeleteAfterUpload },
  })
}
