/**
 * What Ollama's server log says about one load of a model: the buffers its llama-server allocated, and the settings it
 * started with.
 *
 * Ollama 0.40.16 reports 0.3 to 1.0 GiB as the `/api/ps` size of a GGUF gemma4 model whose buffers take several GiB,
 * so the log is the only reliable account of what a load costs. Sizes are MiB as the log prints them; a device whose
 * name does not start with `CPU` (Metal `MTL0`, `CUDA0`, `ROCm0`, `Vulkan0`) counts as GPU memory.
 */
export interface OllamaLoadBuffers {
  /** Model weights mapped on the GPU. */
  gpuWeightsMiB: number
  /** Model weights left in CPU memory, such as token embeddings that the runner keeps on the CPU. */
  cpuWeightsMiB: number
  /** KV and recurrent-state cache on the GPU. */
  gpuCacheMiB: number
  /** The largest GPU compute buffer the scheduler reserved. */
  gpuComputeMiB: number
  /** The runner's worst-case estimate for a vision projector, when the model has one. */
  projectorEstimateMiB: number | null
  /** The `-c` the runner started with. */
  contextLength: number | null
  flashAttention: string | null
  cacheTypeK: string | null
  cacheTypeV: string | null
}

const START = 'msg="starting llama-server"'
const WEIGHTS = /^load_tensors:\s+(\S+?)(?:_Mapped)? model buffer size\s*=\s*([\d.]+) MiB/
const CACHE = /^llama_kv_cache:\s+(\S+) (?:KV|RS) buffer size\s*=\s*([\d.]+) MiB/
const COMPUTE = /^\w+:\s+(\S+) compute buffer size\s*=\s*([\d.]+) MiB/
const PROJECTOR = /worst-case memory usage of mmproj is ([\d.]+) MiB/

const isGpu = (device: string) => !device.startsWith('CPU')
const flag = (command: string, name: string) => new RegExp(`(?:^|\\s)${name} (\\S+)`).exec(command)?.[1] ?? null

/**
 * Reads the buffers of the most recent load of the model file `blobSha256` from the text of an Ollama server log.
 *
 * Returns:
 * - `null` when the log holds no load of that file, or when the load has not printed its buffers yet.
 */
export function parseOllamaLoad(log: string, blobSha256: string): OllamaLoadBuffers | null {
  const lines = log.split('\n')
  let start = -1
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index]!.includes(START) && lines[index]!.includes(`sha256-${blobSha256}`)) {
      start = index
      break
    }
  }
  if (start === -1)
    return null
  const command = /cmd="([^"]*)"/.exec(lines[start]!)?.[1] ?? ''
  const load: OllamaLoadBuffers = {
    gpuWeightsMiB: 0,
    cpuWeightsMiB: 0,
    gpuCacheMiB: 0,
    gpuComputeMiB: 0,
    projectorEstimateMiB: null,
    contextLength: flag(command, '-c') === null ? null : Number(flag(command, '-c')),
    flashAttention: flag(command, '--flash-attn'),
    cacheTypeK: flag(command, '--cache-type-k'),
    cacheTypeV: flag(command, '--cache-type-v'),
  }
  let seen = false
  for (const line of lines.slice(start + 1)) {
    // The next load ends this one.
    if (line.includes(START))
      break
    const weights = WEIGHTS.exec(line)
    if (weights) {
      seen = true
      if (isGpu(weights[1]!))
        load.gpuWeightsMiB += Number(weights[2])
      else
        load.cpuWeightsMiB += Number(weights[2])
      continue
    }
    const cache = CACHE.exec(line)
    if (cache && isGpu(cache[1]!)) {
      load.gpuCacheMiB += Number(cache[2])
      continue
    }
    const compute = COMPUTE.exec(line)
    if (compute && isGpu(compute[1]!)) {
      load.gpuComputeMiB = Math.max(load.gpuComputeMiB, Number(compute[2]))
      continue
    }
    const projector = PROJECTOR.exec(line)
    if (projector)
      load.projectorEstimateMiB = Number(projector[1])
  }
  if (!seen)
    return null
  const round = (value: number) => Math.round(value * 100) / 100
  return { ...load, gpuWeightsMiB: round(load.gpuWeightsMiB), cpuWeightsMiB: round(load.cpuWeightsMiB), gpuCacheMiB: round(load.gpuCacheMiB) }
}
