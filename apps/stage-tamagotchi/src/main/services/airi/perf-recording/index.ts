import type { CpuTimes, PerfRecord, SampleRecord, SessionStartRecord, UsageEventRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfRecordingState } from '../../../../shared/eventa'
import type { PerfIdentityValue } from './identity'
import type { PerfHostDescription, PerfRecordingServiceOptions } from './types'

import process from 'node:process'

import { join } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { CpuDeltaTracker, PERF_RECORD_VERSION } from '@proj-airi/stage-shared/perf/usage'
import { Mutex } from 'async-mutex'

import { perfIdentityChanged, readIdentityChange } from './identity'
import { resolvePerfRecording } from './mode'
import { pulledRecords, pullWindowRollup } from './pull'
import { identityRecord, sessionStartRecord, usageEvent } from './records'
import { cpuReadings, cpuUsageMs, describeProcesses, measureMachine } from './sample'
import { createPerfSessionId, PERF_FILE_MODE, PerfSegmentFile } from './segment-file'
import { STAGE_WINDOW_LABELS } from './window-label'

export type { PerfRecordingFs } from './segment-file'
export type { PerfHostDescription, PerfRecordingServiceOptions, PerfRecordingTimers, PerfWindowSource } from './types'

const TICK_INTERVAL_MS = 5_000
const RELOAD_DEBOUNCE_MS = 2_000

const log = useLogg('main/perf-recording').useGlobalConfig()

interface ActiveSession {
  file: PerfSegmentFile
  sessionId: string
  host: PerfHostDescription
  startedBy: SessionStartRecord['startedBy']
  identity: PerfIdentityValue
  epoch: number
  tick: number
  lastTickAt: number
  previousCpuTimes: CpuTimes[]
  cpu: CpuDeltaTracker
  /** Events waiting for the next tick's append. */
  pending: PerfRecord[]
  cancelInterval: () => void
}

/**
 * Records the app's usage performance while enabled: every 5 s it reads the app's processes and the machine load,
 * pulls each stage window's rollup, and writes them with one append to the session's raw segment.
 *
 * `setEnabled` and `dispose` share one mutex with the tick, so a stop waits for an in-flight tick and never cuts a
 * line short. While disabled nothing is scheduled, pulled or written, and the directory is not created.
 */
export class PerfRecordingService {
  private readonly listeners = new Set<(state: PerfRecordingState) => void>()
  private readonly mutex = new Mutex()
  private resolution: ReturnType<typeof resolvePerfRecording>
  private session: ActiveSession | null = null
  private ticking = false
  private writeFailing = false
  private readonly reloadedWindows = new Set<string>()
  private cancelReload: (() => void) | null = null

  constructor(private readonly options: PerfRecordingServiceOptions) {
    this.resolution = resolvePerfRecording({ ...options.mode, stored: options.getStoredEnabled() })
  }

  getState(): PerfRecordingState {
    const { enabled, buildMode, source } = this.resolution
    return { enabled, active: this.session !== null, sessionId: this.session?.sessionId ?? null, directory: this.options.directory, buildMode, source }
  }

  onStateChange(listener: (state: PerfRecordingState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Starts recording when the launch resolves to on: the dev-only environment override, the stored toggle, or the build default. */
  async restore(): Promise<void> {
    if (this.resolution.enabled)
      await this.setEnabled(true, false)
  }

  /**
   * `persist` marks a user toggle: it is stored, and a session it starts records `startedBy: 'toggle'`.
   *
   * The stored choice is always written, but the launch precedence still decides what runs: while `AIRI_PERF_RECORD`
   * overrides, recording follows the environment and the state keeps `source: 'env'`, so the toggle applies at the next
   * launch without the override.
   */
  async setEnabled(enabled: boolean, persist = true): Promise<PerfRecordingState> {
    return await this.mutex.runExclusive(async () => {
      const resolution = persist
        ? resolvePerfRecording({ ...this.options.mode, stored: enabled })
        : { ...this.resolution, enabled }
      if (resolution.enabled)
        await this.start(resolution.source)
      else
        await this.stop()

      this.resolution = resolution
      if (persist)
        this.options.setStoredEnabled(enabled)
      const state = this.getState()
      for (const listener of this.listeners)
        listener(state)
      return state
    })
  }

  /** A stage window reloaded. After 2 s without another reload the identity is read again, and a change starts a new epoch. */
  rendererReloaded(windowLabel: string): void {
    if (!this.session)
      return
    this.reloadedWindows.add(windowLabel)
    this.cancelReload?.()
    this.cancelReload = this.options.timers.setTimeout(() => {
      this.cancelReload = null
      this.applyReload().catch(error => log.withError(error).error('Failed to check the identity after a renderer reload'))
    }, RELOAD_DEBOUNCE_MS)
  }

  powerChanged(name: 'suspend' | 'resume'): void {
    this.session?.pending.push(this.event(this.session, { name, detail: {} }))
  }

  /** Stops the session for an app quit without changing the stored toggle. */
  async dispose(): Promise<void> {
    await this.mutex.runExclusive(() => this.stop())
  }

  private async start(startedBy: SessionStartRecord['startedBy']): Promise<void> {
    if (this.session)
      return

    const { fs, now } = this.options
    const startedAt = now()
    const sessionId = createPerfSessionId(startedAt)
    const rawDirectory = join(this.options.directory, 'raw')
    await fs.mkdir(rawDirectory, { recursive: true, mode: 0o700 })
    const [identity, host] = await Promise.all([this.options.identity.read(), this.options.describeHost()])
    const file = new PerfSegmentFile(fs, rawDirectory, sessionId, startedAt)
    await fs.writeFile(file.livePath, `${process.pid}\n`, { mode: PERF_FILE_MODE })

    try {
      // The first reading seeds the CPU deltas, so the first sample already carries CPU shares.
      const cpu = new CpuDeltaTracker()
      cpu.update(cpuReadings(this.options.getAppMetrics()), this.options.monotonicNow())
      const machine = await this.options.readMachine()
      const session: ActiveSession = {
        file,
        sessionId,
        host,
        startedBy,
        identity,
        epoch: 0,
        tick: 0,
        lastTickAt: this.options.monotonicNow(),
        previousCpuTimes: machine.cpuTimes,
        cpu,
        pending: [],
        cancelInterval: () => {},
      }
      await file.append([...this.headerRecords(session, startedAt), this.event(session, { name: 'recording-start', detail: { source: startedBy } })])
      session.cancelInterval = this.options.timers.setInterval(() => this.onInterval(), TICK_INTERVAL_MS)
      this.session = session
      log.log(`Perf recording started: session ${sessionId} (${startedBy}) in ${this.options.directory}`)
    }
    catch (error) {
      await fs.rm(file.livePath, { force: true })
      throw error
    }
  }

  private async stop(): Promise<void> {
    const session = this.session
    if (!session)
      return
    this.session = null
    session.cancelInterval()
    this.cancelReload?.()
    this.cancelReload = null
    this.reloadedWindows.clear()

    try {
      await session.file.append([...session.pending.splice(0), this.event(session, { name: 'recording-stop', detail: {} })])
    }
    catch (error) {
      log.withError(error).error('Failed to write the end of the perf recording')
    }
    finally {
      // Without the `.live` file a later start treats the session as finished instead of crashed.
      await this.options.fs.rm(session.file.livePath, { force: true })
    }
    log.log(`Perf recording stopped: session ${session.sessionId}`)
  }

  private onInterval(): void {
    // A tick that outlasts the interval makes the next one skip instead of queueing behind it.
    if (this.ticking)
      return
    this.ticking = true
    this.mutex.runExclusive(() => this.tick())
      .catch(error => log.withError(error).error('Failed to record a perf sample'))
      .finally(() => {
        this.ticking = false
      })
  }

  private async tick(): Promise<void> {
    const session = this.session
    if (!session)
      return

    const collectStart = process.cpuUsage()
    session.tick += 1
    const t = this.options.now()
    const at = this.options.monotonicNow()
    const metrics = this.options.getAppMetrics()
    const windows = this.options.getWindows()
    const processes = describeProcesses(metrics, windows, session.cpu.update(cpuReadings(metrics), at))
    let recorderMs = cpuUsageMs(process.cpuUsage(collectStart))

    const stageWindows = windows.filter(window => STAGE_WINDOW_LABELS.has(window.label))
    const [reading, pulls] = await Promise.all([
      this.options.readMachine(),
      Promise.all(stageWindows.map(window => pullWindowRollup(window, session.tick, this.options.timers))),
    ])

    const buildStart = process.cpuUsage()
    const { machine, hostContended } = measureMachine({ reading, previousCpuTimes: session.previousCpuTimes, processes })
    session.previousCpuTimes = reading.cpuTimes
    const records: PerfRecord[] = []
    if (session.file.shouldRotate(t)) {
      session.file.rotate(t)
      records.push(...this.headerRecords(session, t))
    }
    records.push(...session.pending.splice(0))
    const sample: SampleRecord = {
      v: PERF_RECORD_VERSION,
      t,
      sessionId: session.sessionId,
      kind: 'sample',
      epoch: session.epoch,
      intervalMs: at - session.lastTickAt,
      processes,
      machine,
      hostContended,
      chromiumTrace: false,
      recorderMs: 0,
      bytesWritten: session.file.sessionBytes,
    }
    session.lastTickAt = at
    records.push(sample)

    records.push(...pulledRecords(pulls, stageWindows, { t, sessionId: session.sessionId, epoch: session.epoch }))
    recorderMs += cpuUsageMs(process.cpuUsage(buildStart))
    sample.recorderMs = recorderMs

    try {
      await session.file.append(records)
      this.writeFailing = false
    }
    catch (error) {
      // A failing disk fails every tick; one log line per failure streak keeps the log readable.
      if (!this.writeFailing)
        log.withError(error).error('Failed to write perf records')
      this.writeFailing = true
    }
  }

  private async applyReload(): Promise<void> {
    const session = this.session
    if (!session)
      return
    const windows = [...this.reloadedWindows]
    this.reloadedWindows.clear()
    const next = await readIdentityChange(this.options.identity, session.identity)

    await this.mutex.runExclusive(() => {
      if (this.session !== session)
        return
      const t = this.options.now()
      // An overlapping check may have recorded this identity already.
      const changed = next !== null && perfIdentityChanged(session.identity, next)
      if (changed) {
        session.identity = next
        session.epoch += 1
        session.pending.push(identityRecord(t, session))
      }
      for (const window of windows)
        session.pending.push(this.event(session, { name: 'renderer-reload', window, detail: { identityChanged: changed } }, t))
    })
  }

  /** The first lines of every segment: `session-start` with the segment number, then the current identity. */
  private headerRecords(session: ActiveSession, t: number): PerfRecord[] {
    const { sessionId, host, startedBy } = session
    return [
      sessionStartRecord(t, { sessionId, segment: session.file.segment, ...host, buildMode: this.resolution.buildMode, startedBy }),
      identityRecord(t, session),
    ]
  }

  private event(session: ActiveSession, event: Pick<UsageEventRecord, 'name' | 'detail' | 'window'>, t = this.options.now()): UsageEventRecord {
    return usageEvent(t, session.sessionId, event)
  }
}
