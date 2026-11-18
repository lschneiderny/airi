import { describe, expect, it } from 'vitest'

import { parseOllamaLoad } from './ollama-log'

const blob = 'a'.repeat(64)
const other = 'b'.repeat(64)
const start = (sha: string, flags = '') => `time=2026-11-18T12:41:59.929-05:00 level=INFO source=llama_server.go:467 msg="starting llama-server" cmd="/opt/ollama/llama-server --model /home/user/.ollama/models/blobs/sha256-${sha} --port 56019 -c 16384 -np 1${flags}"`

describe('parseOllamaLoad', () => {
  it('sums the GPU and CPU buffers of the latest load of the model file', () => {
    const log = [
      start(blob, ' -c 8192'),
      'load_tensors:  MTL0_Mapped model buffer size =   999.00 MiB',
      start(other),
      'load_tensors:  MTL0_Mapped model buffer size =   888.00 MiB',
      start(blob, ' --flash-attn auto --cache-type-k q8_0 --cache-type-v q8_0'),
      'load_tensors:   CPU_Mapped model buffer size =  2205.00 MiB',
      'load_tensors:  MTL0_Mapped model buffer size =    52.51 MiB',
      'load_tensors:  MTL0_Mapped model buffer size =   574.59 MiB',
      'llama_kv_cache:       MTL0 KV buffer size =    60.00 MiB',
      'llama_kv_cache:       MTL0 KV buffer size =   256.00 MiB',
      'llama_kv_cache:        CPU KV buffer size =    12.00 MiB',
      'srv    load_model: [mtmd] estimated worst-case memory usage of mmproj is 1158.57 MiB (took 84.85 ms)',
      'sched_reserve:       MTL0 compute buffer size =   317.21 MiB',
      'sched_reserve:        CPU compute buffer size =   117.06 MiB',
      'reserve_compute_meta:       MTL0 compute buffer size =   101.27 MiB',
    ].join('\n')

    expect(parseOllamaLoad(log, blob)).toEqual({
      gpuWeightsMiB: 627.1,
      cpuWeightsMiB: 2205,
      gpuCacheMiB: 316,
      gpuComputeMiB: 317.21,
      projectorEstimateMiB: 1158.57,
      contextLength: 16384,
      flashAttention: 'auto',
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q8_0',
    })
  })

  it('counts CUDA buffers as GPU memory', () => {
    const log = [start(blob), 'load_tensors:        CUDA0 model buffer size =  4000.00 MiB', 'llama_kv_cache:      CUDA0 KV buffer size =   512.00 MiB'].join('\n')

    expect(parseOllamaLoad(log, blob)).toMatchObject({ gpuWeightsMiB: 4000, gpuCacheMiB: 512, flashAttention: null })
  })

  it('is null without a load of the file, or before the load printed its buffers', () => {
    expect(parseOllamaLoad(start(other), blob)).toBeNull()
    expect(parseOllamaLoad(start(blob), blob)).toBeNull()
  })
})
