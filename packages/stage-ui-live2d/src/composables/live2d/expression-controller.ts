import type { Ref } from 'vue'

import type { NamedExpressionDefinition } from '../../stores/expression-store'
import type { FreeParameter } from '../../utils/expression-catalog/free-parameters'
import type { PixiLive2DInternalModel } from './motion-manager'

import { errorMessageFrom } from '@moeru/std'
import { parseExp3Expression } from '@proj-airi/stage-shared/expression-performance'

import { useExpressionStore } from '../../stores/expression-store'

export interface Model3ExpressionRef {
  Name: string
  File: string
}

export interface ArchiveExpressionFile {
  name: string
  fileName: string
  data: unknown
}

export interface ExpressionControllerOptions {
  internalModel: Ref<PixiLive2DInternalModel | undefined>
}

/** Adapts archive discovery and the core model to the renderer-owned composer. */
export function useExpressionController(options: ExpressionControllerOptions) {
  const store = useExpressionStore()
  let generation = 0

  async function initialise(
    modelId: string | undefined,
    expressionRefs: Model3ExpressionRef[],
    readExpFile: (path: string) => Promise<string>,
    archiveFiles: ArchiveExpressionFile[] = [],
    resolvePath: (path: string) => string = path => path,
    vtube?: unknown,
    displayInfo?: unknown,
    parameterIds: string[] = [],
    freeParameters: FreeParameter[] = [],
  ) {
    const loadGeneration = ++generation
    const loadedModel = options.internalModel.value
    const files = new Map(archiveFiles.map(file => [file.fileName, file]))
    const names = new Map(expressionRefs.map(reference => [resolvePath(reference.File), reference.Name]))
    for (const reference of expressionRefs) {
      const id = resolvePath(reference.File)
      if (files.has(id))
        continue
      try {
        files.set(id, { name: reference.Name, fileName: id, data: JSON.parse(await readExpFile(reference.File)) })
      }
      catch (error) {
        console.warn(`[expression-controller] Failed to load "${reference.File}":`, errorMessageFrom(error))
      }
    }
    const definitions: NamedExpressionDefinition[] = []
    for (const file of files.values()) {
      try {
        const data = parseExp3Expression(file.data)
        definitions.push({
          id: file.fileName,
          name: names.get(file.fileName) ?? file.name,
          fadeIn: data.FadeInTime,
          fadeOut: data.FadeOutTime,
          parameters: data.Parameters.map(parameter => ({
            id: parameter.Id,
            value: parameter.Value,
            blend: parameter.Blend === 'Multiply' || parameter.Blend === 'Overwrite' ? parameter.Blend : 'Add',
          })),
        })
      }
      catch (error) {
        console.warn(`[expression-controller] Failed to parse "${file.fileName}":`, errorMessageFrom(error))
      }
    }
    // A completed load owns registration; a detached model must not publish stale state.
    if (loadedModel && options.internalModel.value === loadedModel && loadGeneration === generation) {
      const writtenIds = new Set(definitions.flatMap(definition => definition.parameters.map(parameter => parameter.id)))
      store.registerDefinitions(modelId ?? 'unknown', definitions, expressionRefs.map(ref => ({ ...ref, File: resolvePath(ref.File) })), vtube, displayInfo, parameterIds, freeParameters.filter(parameter => !writtenIds.has(parameter.id)))
    }
  }

  function restoreExpressionBases(coreModel: PixiLive2DInternalModel['coreModel']) {
    store.composer.restoreBases((id, value) => coreModel.setParameterValueById(id, value))
  }

  function applyExpressions(coreModel: PixiLive2DInternalModel['coreModel']) {
    const now = performance.now() / 1000
    store.tickLeases(now)
    store.composer.compose(
      now,
      id => coreModel.getParameterValueById(id),
      (id, value) => coreModel.setParameterValueById(id, value),
      (id) => {
        const index = coreModel.getParameterIndex(id)
        return [coreModel.getParameterMinimumValue(index), coreModel.getParameterMaximumValue(index)]
      },
    )
  }

  function dispose() {
    generation++
    const coreModel = options.internalModel.value?.coreModel
    if (coreModel)
      restoreExpressionBases(coreModel)
    store.dispose()
  }

  return { initialise, restoreExpressionBases, applyExpressions, dispose }
}
