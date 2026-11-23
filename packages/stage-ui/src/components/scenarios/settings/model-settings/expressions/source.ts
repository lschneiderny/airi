import type { CatalogEntry, ComboDocument, CuratedOverride, CustomExpressionDocument, ItemExpressionDocument, ItemRenderState } from '@proj-airi/stage-shared/expression-performance'

/**
 * The renderer-neutral contract between the expression panel and the store that owns a model's expressions.
 *
 * `useExpressionStore` in `@proj-airi/stage-ui-live2d` and `useMMDExpressionStore` in `@proj-airi/stage-ui-mmd`
 * both satisfy it structurally: the panel never imports a renderer store. In Electron the settings window holds
 * a copy of the snapshot and sends commands back over the model-settings runtime channel.
 */

/** One catalog entry with the state the panel renders; `usesOverwrite` exists only for Live2D parameter blends. */
export interface ExpressionPanelEntry extends CatalogEntry {
  name: string
  active: boolean
  effective: boolean
  overriddenBy: string | null
  via: string[]
  isDefault: boolean
  usesOverwrite?: boolean
}

/** A model parameter no expression writes; Live2D offers each one as a custom switch. */
export interface ExpressionPanelFreeParameter {
  id: string
  name: string
  min: number
  max: number
  default: number
}

/** One stored stage item of the model: whether its library asset exists, whether it shows now, and what the renderer reported. */
export interface ExpressionPanelItem {
  document: ItemExpressionDocument
  available: boolean
  shown: boolean
  /** Null while the renderer draws nothing for it. */
  state: ItemRenderState | null
}

export interface ExpressionPanelSnapshot {
  entries: ExpressionPanelEntry[]
  /** Choose-one sets: at most one member of a group is active at a time. */
  groups: { id: string, memberIds: string[] }[]
  activeIds: string[]
  restIds: string[]
  /** Present only when the renderer supports custom switches. */
  freeParameters?: ExpressionPanelFreeParameter[]
  /** Set when the renderer lets the character use entries on her own; the entry editor then offers the choice. */
  supportsIdleUse?: boolean
  /** Present only when the renderer supports stage items. */
  items?: ExpressionPanelItem[]
  /**
   * Her model canvas in canvas units, once the renderer reports it and while a model is loaded. A new item is placed relative to it; the panel
   * offers "Add to this model" only while it is known.
   */
  canvas?: { width: number, height: number }
}

export type CreateComboInput = Pick<ComboDocument, 'label' | 'members'> & Partial<Pick<ComboDocument, 'mappings' | 'area'>> & { emotion?: ComboDocument['mappings'][number]['emotion'] }
/** `area: null` clears a stored area; an absent key leaves it unchanged. */
export type ComboPatch = Partial<Pick<ComboDocument, 'label' | 'members' | 'mappings' | 'exposedToLlm'>> & { area?: ComboDocument['area'] | null }
/** `area: null` clears a stored area override; an absent key leaves it unchanged. */
export type EntryPatch = Omit<CuratedOverride, 'id' | 'area'> & { area?: CuratedOverride['area'] | null }
export type CustomPatch = Partial<Omit<CustomExpressionDocument, 'id' | 'parameterId' | 'area' | 'delta'>> & { area?: CustomExpressionDocument['area'] | null, target?: number }
/** `exposedToLlm` defaults to false; `hides` and `link` take their schema defaults. */
export type CreateItemInput = Omit<ItemExpressionDocument, 'id' | 'exposedToLlm' | 'hides' | 'link'> & Partial<Pick<ItemExpressionDocument, 'exposedToLlm' | 'hides' | 'link'>>
/** `area: null` clears a stored item area; an absent key leaves it unchanged. */
export type ItemPatch = Partial<Omit<ItemExpressionDocument, 'id' | 'area'>> & { area?: ItemExpressionDocument['area'] | null }

/** Commands every expression store accepts: curate, set active and rest, create combos, reset. */
export type ExpressionPanelCommand
  = | { type: 'toggle', id: string }
    | { type: 'save-defaults' }
    | { type: 'reset-all' }
    | { type: 'update-entry', id: string, patch: EntryPatch }
    | { type: 'reset-entry', id: string }
    | { type: 'set-active', id: string, active: boolean }
    | { type: 'create-combo', combo: CreateComboInput }
    | { type: 'update-combo', id: string, patch: ComboPatch }
    | { type: 'delete-combo', id: string }

/** Custom-switch commands; only a source that publishes `freeParameters` receives them. */
export type ExpressionPanelCustomCommand
  = | { type: 'create-custom', custom: { label: string, parameterId: string, target: number } }
    | { type: 'update-custom', id: string, patch: CustomPatch }
    | { type: 'delete-custom', id: string }

export function isExpressionPanelCustomCommand(command: ExpressionPanelCommand | ExpressionPanelCustomCommand): command is ExpressionPanelCustomCommand {
  return command.type === 'create-custom' || command.type === 'update-custom' || command.type === 'delete-custom'
}

/** Stage item commands; only a source that publishes `items` receives them. */
export type ExpressionPanelItemCommand
  = | { type: 'create-item', item: CreateItemInput }
    | { type: 'update-item', id: string, patch: ItemPatch }
    | { type: 'delete-item', id: string }

/** What the panel's editors emit; the panel splits it onto the three events. */
export type AnyExpressionPanelCommand = ExpressionPanelCommand | ExpressionPanelCustomCommand | ExpressionPanelItemCommand

export function isExpressionPanelItemCommand(command: AnyExpressionPanelCommand): command is ExpressionPanelItemCommand {
  return command.type === 'create-item' || command.type === 'update-item' || command.type === 'delete-item'
}

/** What a renderer store exposes to the panel; the Live2D and MMD expression stores both satisfy it. */
export interface ExpressionPanelSource {
  readonly settingsSnapshot: ExpressionPanelSnapshot
  applySettingsCommand: (command: ExpressionPanelCommand) => unknown
}
