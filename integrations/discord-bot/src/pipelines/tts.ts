import type { Buffer } from 'node:buffer'

import type { AutomaticSpeechRecognitionPipelineType, ProgressCallback } from '@huggingface/transformers'

import { env } from 'node:process'

import wavefile from 'wavefile'

import { useLogg } from '@guiiai/logg'
import { pipeline } from '@huggingface/transformers'
import { toWav } from '@proj-airi/audio'
import { createOpenAI } from '@xsai-ext/providers/create'
import { generateTranscription } from '@xsai/generate-transcription'

const whisperModel = 'Xenova/whisper-medium.en'
let whisperPipeline: AutomaticSpeechRecognitionPipelineType | null = null

/** The process-wide Whisper pipeline, loaded on first use. */
export async function getWhisperPipeline(progress_callback?: ProgressCallback) {
  whisperPipeline ??= await pipeline('automatic-speech-recognition', whisperModel, { progress_callback })
  return whisperPipeline
}

export function textFromResult(result: Array<{ text: string }> | { text: string }) {
  if (Array.isArray(result)) {
    const arrayResult = result as { text: string }[]
    if (arrayResult.length === 0) {
      return ''
    }

    return result[0].text
  }
  else {
    if ('text' in result) {
      return result.text
    }
    else {
      return ''
    }
  }
}

export async function transcribe(pcmBuffer: Buffer) {
  const log = useLogg('Memory:Transcribe').useGlobalConfig()

  const pcmConvertedWav = toWav(pcmBuffer.buffer, 48000, 2)
  log.withFields({ from: pcmBuffer.byteLength, to: pcmConvertedWav.byteLength }).log('Audio data received')

  const transcriber = await getWhisperPipeline()
  log.log('Transcribing audio')

  const wav = new wavefile.WaveFile(new Uint8Array(pcmConvertedWav))
  wav.toBitDepth('32f') // Pipeline expects input as a Float32Array
  wav.toSampleRate(16000) // Whisper expects audio with a sampling rate of 16000
  const audioData = wav.getSamples()

  const result = await transcriber(audioData)
  const text = textFromResult(result)
  if (!text) {
    log.log('No transcription result')
    return ''
  }

  log.withField('result', text).log('Transcription result')
  return text
}

export async function openaiTranscribe(wavBuffer: Buffer) {
  const log = useLogg('Remote:Transcribe').useGlobalConfig()

  log.log('Transcribing audio...')

  const apiKey = env.OPENAI_STT_API_KEY
  const model = env.OPENAI_STT_MODEL
  if (!apiKey || !model) {
    log.error('OPENAI_STT_API_KEY and OPENAI_STT_MODEL must be set to transcribe audio')
    return ''
  }

  const wavFile = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' })
  const openai = createOpenAI(apiKey, env.OPENAI_STT_API_BASE_URL)

  try {
    const result = await generateTranscription({
      ...openai.transcription(model),
      file: wavFile,
    })

    log.withField('result', result.text).log('Transcription result')
    return result.text
  }
  catch (err) {
    log.withError(err).error('Failed to transcribe audio')
  }

  return ''
}
