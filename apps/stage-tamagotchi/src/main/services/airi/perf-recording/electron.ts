import type { PerfHostDescription, PerfRecordingServiceOptions, PerfWindowSource } from '.'
import type { PerfExec } from './identity'
import type { PerfMachineReading } from './sample'

import process, { env } from 'node:process'

import { execFile } from 'node:child_process'
import { access, appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, loadavg, platform, totalmem } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

import { useLogg } from '@guiiai/logg'
import { defineInvoke } from '@moeru/eventa'
import { abbreviatedSha, branch, sha } from '~build/git'
import { app, BrowserWindow, contentTracing, powerMonitor } from 'electron'
import { array, boolean, number, object, optional, safeParse } from 'valibot'

import { PerfRecordingService } from '.'
import { perfRecordingPullFrameRing, perfRecordingPullRollup } from '../../../../shared/eventa'
import { createWindowContext } from '../../../libs/electron/window-context'
import { PerfIdentity } from './identity'
import { resolvePerfDirectoryOverride } from './mode'
import { windowLabelFromUrl } from './window-label'

const execFileAsync = promisify(execFile)
// A valid `git diff HEAD` can exceed Node's 1 MiB default; an overflow falls back to build info.
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024

const exec: PerfExec = async (command, args, { cwd, timeoutMs }) => {
  const { stdout } = await execFileAsync(command, [...args], { cwd, timeout: timeoutMs, maxBuffer: GIT_MAX_BUFFER_BYTES, encoding: 'utf8', windowsHide: true })
  return stdout
}

function readWindows(): PerfWindowSource[] {
  return BrowserWindow.getAllWindows()
    .filter(window => !window.isDestroyed() && !window.webContents.isDestroyed())
    .map((window) => {
      const contents = window.webContents
      const devtools = contents.isDevToolsOpened() ? contents.devToolsWebContents : null
      return {
        label: windowLabelFromUrl(contents.getURL()),
        osPid: contents.getOSProcessId(),
        visible: window.isVisible() && !window.isMinimized(),
        devtoolsOsPid: devtools && !devtools.isDestroyed() ? devtools.getOSProcessId() : null,
        // The context is resolved per pull, so only pulled windows get one, and a window closed since then rejects.
        pullRollup: (request, signal) => defineInvoke(createWindowContext(window).context, perfRecordingPullRollup)(request, { signal }),
        pullFrameRing: signal => defineInvoke(createWindowContext(window).context, perfRecordingPullFrameRing)(undefined, { signal }),
      }
    })
}

async function readPsi(): Promise<string | null> {
  try {
    return await readFile('/proc/pressure/cpu', 'utf8')
  }
  catch {
    // Kernels without PSI, `psi=0` and some containers refuse the read; the sample then records PSI as unavailable.
    return null
  }
}

async function readMachine(): Promise<PerfMachineReading> {
  const cores = cpus()
  return {
    load1: loadavg()[0],
    cores: cores.length,
    cpuTimes: cores.map(core => core.times),
    psiText: platform() === 'linux' ? await readPsi() : null,
  }
}

const GpuInfoSchema = object({
  gpuDevice: array(object({ active: optional(boolean()), vendorId: number(), deviceId: number() })),
})

/** The active GPU as `vendorId:deviceId` in hex. Renderer strings such as `.../PCIe/SSE2` would read as paths to the privacy check. */
async function readGpu(): Promise<string | null> {
  try {
    const parsed = safeParse(GpuInfoSchema, await app.getGPUInfo('basic'))
    const devices = parsed.success ? parsed.output.gpuDevice : []
    const device = devices.find(candidate => candidate.active) ?? devices[0]
    return device ? `${device.vendorId.toString(16)}:${device.deviceId.toString(16)}` : null
  }
  catch (error) {
    useLogg('main/perf-recording').useGlobalConfig().withError(error).warn('GPU info is unavailable')
    return null
  }
}

async function describeHost(): Promise<PerfHostDescription> {
  const cores = cpus()
  return {
    host: { platform: platform(), arch: arch(), cpuModel: cores[0]?.model ?? '', cores: cores.length, totalMemKb: Math.round(totalmem() / 1024), gpu: await readGpu() },
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
  }
}

/**
 * Builds the recorder over Electron and Node. Recordings go to `AIRI_PERF_DIR` in a development build when it is set,
 * else to `perf` under the user data directory that the app reports at runtime.
 */
export function createElectronPerfRecording(stored: Pick<PerfRecordingServiceOptions, 'getStoredEnabled' | 'setStoredEnabled'>): PerfRecordingService {
  const dev = import.meta.env.DEV
  return new PerfRecordingService({
    directory: resolvePerfDirectoryOverride(dev, env) ?? join(app.getPath('userData'), 'perf'),
    now: () => Date.now(),
    monotonicNow: () => performance.now(),
    timers: {
      setInterval: (callback, ms) => {
        const handle = setInterval(callback, ms)
        return () => clearInterval(handle)
      },
      setTimeout: (callback, ms) => {
        const handle = setTimeout(callback, ms)
        return () => clearTimeout(handle)
      },
    },
    getAppMetrics: () => app.getAppMetrics(),
    getWindows: readWindows,
    readMachine,
    describeHost,
    identity: new PerfIdentity({
      dev,
      appPath: app.getAppPath(),
      buildInfo: { sha, abbreviatedSha, branch },
      exec,
      pathExists: path => access(path).then(() => true, () => false),
    }),
    mode: { dev, packaged: app.isPackaged, env },
    ...stored,
    fs: { mkdir, appendFile, writeFile, readdir: path => readdir(path), rm },
    contentTracing,
  })
}

/** Records suspend and resume as events. Returns the function that stops listening. */
export function watchPerfPower(service: PerfRecordingService): () => void {
  const onSuspend = () => service.powerChanged('suspend')
  const onResume = () => service.powerChanged('resume')
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)
  return () => {
    powerMonitor.off('suspend', onSuspend)
    powerMonitor.off('resume', onResume)
  }
}
