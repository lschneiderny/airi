import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

import ts from 'typescript'

export type StorageArea = 'localStorage' | 'sessionStorage' | 'indexedDB' | 'opfs' | 'cacheStorage'

export type StorageWriteKey
  = | { exact: string }
    | { prefix: string }
    | { perModel: string }
  /** An IndexedDB driver: its database, its object store when the scan resolves it, and its `base` as a key prefix. */
    | { database: string, store?: string, prefix?: string }
    /** A key the scan cannot resolve; `unresolved` is the key expression. */
    | { unresolved: string }

export interface StorageWriteSite {
  /** Repository path with `/` separators. */
  file: string
  line: number
  area: StorageArea
  /**
   * `write` stores a key, which may not be a `legacy` location. `remove` deletes one, and `open` creates an IndexedDB
   * driver, as a migration from an older database does; both may reach a `legacy` location.
   */
  operation: 'write' | 'remove' | 'open'
  key: StorageWriteKey
}

/** Reads a repository file by its repository path, or returns `undefined` when it does not exist. */
export type ReadRepositoryFile = (path: string) => string | undefined

/** Composables that store under their first argument, with the area they store in. */
const keyedHooks = new Map<string, StorageArea>([
  ['useLocalStorage', 'localStorage'],
  ['useSessionStorage', 'sessionStorage'],
  ['useStorage', 'localStorage'],
  ['useLocalStorageManualReset', 'localStorage'],
  ['useVersionedLocalStorage', 'localStorage'],
  ['useVersionedLocalStorageManualReset', 'localStorage'],
  ['useSettingsDocument', 'localStorage'],
])
/** Composables that store under their second argument, an unscoped key, once per display model. */
const perModelHooks = new Set(['useModelScopedLocalStorage', 'useModelScopedLocalStorageManualReset'])
/** VueUse color mode composables: their `storageKey` option, else VueUse's default key. */
const colorModeHooks = new Set(['useDark', 'useColorMode'])
const defaultColorModeKey = 'vueuse-color-scheme'
/** The defaults of unstorage's IndexedDB driver. */
const defaultDatabase = 'keyval-store'
const defaultStore = 'keyval'

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))
    node = node.expression
  return node
}

interface FileContext {
  path: string
  /** Module-level `const` initializers by name; a name declared more than once maps to `undefined`. */
  constants: Map<string, ts.Expression | undefined>
  /** Imported bindings by local name. */
  imports: Map<string, { specifier: string, name: string }>
  /** Names declared with the DOM `Storage` type, such as a `storage: Storage` parameter. */
  webStorageNames: Set<string>
}

function contextOf(path: string, file: ts.SourceFile): FileContext {
  const context: FileContext = { path, constants: new Map(), imports: new Map(), webStorageNames: new Set() }
  let importsStorageType = false
  const typed: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const bindings = node.importClause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          context.imports.set(element.name.text, { specifier: node.moduleSpecifier.text, name: (element.propertyName ?? element.name).text })
          if (element.name.text === 'Storage')
            importsStorageType = true
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const
      && ts.isVariableStatement(node.parent.parent) && ts.isSourceFile(node.parent.parent.parent)) {
      const name = node.name.text
      context.constants.set(name, context.constants.has(name) ? undefined : node.initializer)
    }
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name) && node.type && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === 'Storage') {
      typed.push(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  // unstorage exports a `Storage` type too; only the DOM type has `setItem` with a string key.
  if (!importsStorageType)
    typed.forEach(name => context.webStorageNames.add(name))
  return context
}

type Resolved = { exact: string } | { prefix: string } | undefined

/** Whether a declared name or binding pattern binds `name`. */
function binds(node: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(node))
    return node.text === name
  return node.elements.some(element => !ts.isOmittedExpression(element) && binds(element.name, name))
}

/**
 * The nearest declaration of `name` in a scope that encloses `node`, below the module scope: the initializer of a
 * `const`, or `shadowed` for a parameter, a loop or catch variable, a `let` or `var`, or a local function or class.
 * Returns `undefined` when no such scope declares it, so only the module scope or an import can.
 */
function localBinding(node: ts.Node, name: string): ts.Expression | 'shadowed' | undefined {
  for (let scope = node.parent; scope && !ts.isSourceFile(scope); scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => binds(parameter.name, name)))
      return 'shadowed'
    if ((ts.isForOfStatement(scope) || ts.isForInStatement(scope) || ts.isForStatement(scope)) && scope.initializer
      && ts.isVariableDeclarationList(scope.initializer) && scope.initializer.declarations.some(declaration => binds(declaration.name, name))) {
      return 'shadowed'
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, name))
      return 'shadowed'
    if (!ts.isBlock(scope) && !ts.isCaseClause(scope) && !ts.isDefaultClause(scope))
      continue
    for (const statement of scope.statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name)
        return 'shadowed'
      if (!ts.isVariableStatement(statement))
        continue
      const declaration = statement.declarationList.declarations.find(candidate => binds(candidate.name, name))
      if (declaration)
        return statement.declarationList.flags & ts.NodeFlags.Const && ts.isIdentifier(declaration.name) && declaration.initializer ? declaration.initializer : 'shadowed'
    }
  }
  return undefined
}

class KeyResolver {
  private readonly contexts = new Map<string, FileContext | undefined>()

  constructor(private readonly read: ReadRepositoryFile) {}

  add(path: string, file: ts.SourceFile): FileContext {
    const context = contextOf(path, file)
    this.contexts.set(path, context)
    return context
  }

  private load(path: string): FileContext | undefined {
    if (!this.contexts.has(path)) {
      const source = this.read(path)
      this.contexts.set(path, source === undefined ? undefined : contextOf(path, ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)))
    }
    return this.contexts.get(path)
  }

  /** The module that a relative import names, as `.ts` or `/index.ts`. */
  private imported(context: FileContext, name: string): { context: FileContext, name: string } | undefined {
    const binding = context.imports.get(name)
    if (!binding?.specifier.startsWith('.'))
      return undefined
    const base = posix.join(posix.dirname(context.path), binding.specifier)
    for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
      const target = this.load(candidate)
      if (target)
        return { context: target, name: binding.name }
    }
    return undefined
  }

  /** The constant expression that `node` names, found through its enclosing scopes first. */
  private named(context: FileContext, node: ts.Identifier, seen: Set<string>): { context: FileContext, value: ts.Expression } | undefined {
    const local = localBinding(node, node.text)
    if (local === 'shadowed')
      return undefined
    if (!local)
      return this.constant(context, node.text, seen)
    const id = `${context.path}@${local.pos}`
    if (seen.has(id))
      return undefined
    seen.add(id)
    return { context, value: local }
  }

  private constant(context: FileContext, name: string, seen: Set<string>): { context: FileContext, value: ts.Expression } | undefined {
    const id = `${context.path}#${name}`
    if (seen.has(id))
      return undefined
    seen.add(id)
    const value = context.constants.get(name)
    if (value)
      return { context, value }
    const target = this.imported(context, name)
    return target ? this.constant(target.context, target.name, seen) : undefined
  }

  /** The object literal a constant expression stands for, such as an `as const` table of keys. */
  private object(context: FileContext, node: ts.Expression, seen: Set<string>): { context: FileContext, value: ts.ObjectLiteralExpression } | undefined {
    node = unwrap(node)
    if (ts.isObjectLiteralExpression(node))
      return { context, value: node }
    if (ts.isIdentifier(node)) {
      const found = this.named(context, node, seen)
      return found ? this.object(found.context, found.value, seen) : undefined
    }
    return undefined
  }

  resolve(context: FileContext, node: ts.Expression, seen = new Set<string>()): Resolved {
    node = unwrap(node)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return { exact: node.text }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text
      for (const span of node.templateSpans) {
        const part = this.resolve(context, span.expression, seen)
        if (!part || !('exact' in part))
          return text ? { prefix: part && 'prefix' in part ? text + part.prefix : text } : undefined
        text += part.exact + span.literal.text
      }
      return { exact: text }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.resolve(context, node.left, seen)
      if (!left || !('exact' in left))
        return left
      const right = this.resolve(context, node.right, seen)
      if (!right)
        return left.exact ? { prefix: left.exact } : undefined
      return 'exact' in right ? { exact: left.exact + right.exact } : { prefix: left.exact + right.prefix }
    }
    if (ts.isIdentifier(node)) {
      const found = this.named(context, node, seen)
      return found ? this.resolve(found.context, found.value, seen) : undefined
    }
    if (ts.isPropertyAccessExpression(node)) {
      const owner = this.object(context, node.expression, seen)
      const property = owner?.value.properties.find((candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === node.name.text)
      return owner && property ? this.resolve(owner.context, property.initializer, seen) : undefined
    }
    return undefined
  }

  /**
   * Every key that `node` can be. Besides {@link resolve}, a name bound by a `for...of` loop over a key list or key
   * table is each of its keys, and a parameter of a function in the file is each argument that the file passes it.
   * Returns an empty list when any of them does not resolve.
   */
  resolveAll(context: FileContext, node: ts.Expression, depth = 0): Exclude<Resolved, undefined>[] {
    node = unwrap(node)
    const single = this.resolve(context, node)
    if (single)
      return [single]
    if (!ts.isIdentifier(node) || depth > 3)
      return []
    const name = node.text
    for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
      if (ts.isForOfStatement(scope)) {
        const loop = loopValues(scope, name)
        if (!loop)
          continue
        const { iterated } = loop
        let items: readonly (ts.Expression | undefined)[] | undefined
        if (!loop.entries && ts.isArrayLiteralExpression(iterated))
          items = iterated.elements
        if (ts.isCallExpression(iterated) && ts.isPropertyAccessExpression(iterated.expression) && ts.isIdentifier(iterated.expression.expression)
          && iterated.expression.expression.text === 'Object' && iterated.expression.name.text === (loop.entries ? 'entries' : 'values') && iterated.arguments[0]) {
          const table = this.object(context, iterated.arguments[0], new Set())
          items = table?.value.properties.map(property => ts.isPropertyAssignment(property) ? property.initializer : undefined)
        }
        return items ? this.allOrNothing(items.map(item => item ? this.resolveAll(context, item, depth + 1) : [])) : []
      }
      if (ts.isFunctionLike(scope)) {
        const index = scope.parameters.findIndex(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === name)
        if (index < 0)
          continue
        const callee = functionName(scope)
        const root = scope.getSourceFile()
        const calls: ts.CallExpression[] = []
        const collect = (child: ts.Node): void => {
          if (ts.isCallExpression(child) && callee && calleeName(child) === callee)
            calls.push(child)
          ts.forEachChild(child, collect)
        }
        collect(root)
        if (!calls.length || calls.some(call => !call.arguments[index]))
          return []
        return this.allOrNothing(calls.map(call => this.resolveAll(context, call.arguments[index], depth + 1)))
      }
    }
    return []
  }

  private allOrNothing(lists: Exclude<Resolved, undefined>[][]): Exclude<Resolved, undefined>[] {
    return lists.some(list => !list.length) ? [] : lists.flat()
  }
}

/** The values a `for...of` loop binds to `name`: an array of keys, or `Object.values` or `Object.entries` of a key table. */
function loopValues(loop: ts.ForOfStatement, name: string): { entries: boolean, iterated: ts.Expression } | undefined {
  const list = loop.initializer
  if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1)
    return undefined
  const binding = list.declarations[0].name
  const iterated = unwrap(loop.expression)
  if (ts.isIdentifier(binding) && binding.text === name)
    return { entries: false, iterated }
  // `for (const [field, key] of Object.entries(table))` binds the values to the second element.
  if (ts.isArrayBindingPattern(binding)) {
    const second = binding.elements[1]
    if (second && ts.isBindingElement(second) && ts.isIdentifier(second.name) && second.name.text === name)
      return { entries: true, iterated }
  }
  return undefined
}

function functionName(node: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(node))
    return node.name?.text
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name))
    return node.parent.name.text
  return undefined
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = unwrap(call.expression)
  return ts.isIdentifier(callee) ? callee.text : undefined
}

/** `localStorage`, `window.sessionStorage`, `globalThis.localStorage`, or a name typed as the DOM `Storage`. */
function webStorageArea(node: ts.Expression, context: FileContext): 'localStorage' | 'sessionStorage' | undefined {
  node = unwrap(node)
  let name: string | undefined
  if (ts.isIdentifier(node))
    name = node.text
  else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ['window', 'globalThis', 'self'].includes(node.expression.text))
    name = node.name.text
  if (name === 'localStorage' || name === 'sessionStorage')
    return name
  // A `Storage` parameter is localStorage in every caller of the renderer.
  if (ts.isIdentifier(node) && context.webStorageNames.has(node.text))
    return 'localStorage'
  return undefined
}

function optionProperty(options: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!options)
    return undefined
  options = unwrap(options)
  if (!ts.isObjectLiteralExpression(options))
    return undefined
  const property = options.properties.find(candidate => candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === name)
  if (property && ts.isPropertyAssignment(property))
    return property.initializer
  if (property && ts.isShorthandPropertyAssignment(property))
    return property.name
  return undefined
}

/** The `<script>` blocks of a `.vue` file, padded with blank lines so positions keep their line numbers. */
function vueScript(source: string): string {
  const lines = source.split('\n').map(() => '')
  const blocks = /<script\b[^>]*>([\s\S]*?)<\/script>/g
  for (const match of source.matchAll(blocks)) {
    const start = source.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length - 1
    match[1].split('\n').forEach((line, offset) => {
      lines[start + offset] = line
    })
  }
  return lines.join('\n')
}

/**
 * The storage write sites of one source file. A `.vue` file is scanned through its script blocks. Keys resolve through
 * string literals, template literals (a prefix up to the first part that does not resolve), `const` declarations that
 * the name's scope reaches, and constants or `as const` object members that a relative import names.
 */
export function findStorageWrites(path: string, source: string, read: ReadRepositoryFile = () => undefined): StorageWriteSite[] {
  const script = path.endsWith('.vue') ? vueScript(source) : source
  const file = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, path.endsWith('.vue') ? ts.ScriptKind.TS : undefined)
  const resolver = new KeyResolver(read)
  const context = resolver.add(path, file)
  const sites: StorageWriteSite[] = []
  const add = (node: ts.Node, area: StorageArea, operation: StorageWriteSite['operation'], keys: StorageWriteKey | StorageWriteKey[]): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    for (const key of Array.isArray(keys) ? keys : [keys])
      sites.push({ file: path, line, area, operation, key })
  }
  const keysOf = (node: ts.Expression | undefined): StorageWriteKey[] => {
    if (!node)
      return [{ unresolved: '' }]
    const keys = resolver.resolveAll(context, node)
    return keys.length ? keys : [{ unresolved: node.getText(file) }]
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (name && keyedHooks.has(name)) {
        const storage = name === 'useStorage' ? node.arguments[2] && webStorageArea(node.arguments[2], context) : undefined
        add(node, storage ?? keyedHooks.get(name)!, 'write', keysOf(node.arguments[0]))
      }
      else if (name && perModelHooks.has(name)) {
        add(node, 'localStorage', 'write', keysOf(node.arguments[1]).map(key => 'exact' in key ? { perModel: key.exact } : key))
      }
      else if (name && colorModeHooks.has(name)) {
        const storageKey = optionProperty(node.arguments[0], 'storageKey')
        if (!storageKey || unwrap(storageKey).kind !== ts.SyntaxKind.NullKeyword)
          add(node, 'localStorage', 'write', storageKey ? keysOf(storageKey) : { exact: defaultColorModeKey })
      }
      else if (name === 'indexedDbDriver') {
        const options = node.arguments[0]
        const database = optionProperty(options, 'dbName')
        const store = optionProperty(options, 'storeName')
        const base = optionProperty(options, 'base')
        const resolvedDatabase = database ? resolver.resolve(context, database) : { exact: defaultDatabase }
        const resolvedStore = store ? resolver.resolve(context, store) : { exact: defaultStore }
        const resolvedBase = base ? resolver.resolve(context, base) : undefined
        if (!resolvedDatabase || !('exact' in resolvedDatabase) || (base && !resolvedBase)) {
          add(node, 'indexedDB', 'open', { unresolved: options?.getText(file) ?? '' })
        }
        else {
          add(node, 'indexedDB', 'open', {
            database: resolvedDatabase.exact,
            ...(resolvedStore && 'exact' in resolvedStore ? { store: resolvedStore.exact } : {}),
            ...(resolvedBase ? { prefix: `${'exact' in resolvedBase ? resolvedBase.exact : resolvedBase.prefix}:` } : {}),
          })
        }
      }
      else if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text
        const receiver = node.expression.expression
        const area = webStorageArea(receiver, context)
        if (area && (method === 'setItem' || method === 'removeItem'))
          add(node, area, method === 'setItem' ? 'write' : 'remove', keysOf(node.arguments[0]))
        if (method === 'getDirectory' && ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage')
          add(node, 'opfs', 'write', { unresolved: 'navigator.storage.getDirectory()' })
        if (method === 'open' && ts.isIdentifier(receiver) && receiver.text === 'caches')
          add(node, 'cacheStorage', 'write', keysOf(node.arguments[0]))
      }
    }
    // `localStorage[key] = value`, `localStorage.key = value`, and `delete localStorage[key]`.
    const target = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ? node.left
      : ts.isDeleteExpression(node) ? node.expression : undefined
    if (target && (ts.isElementAccessExpression(target) || ts.isPropertyAccessExpression(target))) {
      const area = webStorageArea(target.expression, context)
      if (area) {
        const key = ts.isElementAccessExpression(target) ? keysOf(target.argumentExpression) : { exact: target.name.text }
        add(node, area, ts.isDeleteExpression(node) ? 'remove' : 'write', key)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return sites
}

export type RegistryLocation = Record<string, string | boolean>

export interface RegistrySource {
  id: string
  writers: string[]
  locations: RegistryLocation[]
}

function literal(node: ts.Expression, what: string): string | boolean {
  node = unwrap(node)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword)
    return true
  if (node.kind === ts.SyntaxKind.FalseKeyword)
    return false
  throw new Error(`${what} is not a literal: ${node.getText()}`)
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(candidate => ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name)
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined
}

/** Reads the registrations from the registry source; fails when an id, a location, or a writer is not a literal. */
export function readStateRegistry(source: string): RegistrySource[] {
  const file = ts.createSourceFile('state-registry.ts', source, ts.ScriptTarget.Latest, true)
  let registry: ts.ArrayLiteralExpression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node) === 'defineStateRegistry' && node.arguments[0] && ts.isArrayLiteralExpression(unwrap(node.arguments[0])))
      registry = unwrap(node.arguments[0]) as ts.ArrayLiteralExpression
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!registry)
    throw new Error('The registry source has no `defineStateRegistry([...])` call')
  return registry.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element))
      throw new Error(`A registration is not an object literal: ${element.getText()}`)
    const id = propertyOf(element, 'id')
    const writers = propertyOf(element, 'writers')
    const locations = propertyOf(element, 'locations')
    if (!id || !writers || !locations || !ts.isArrayLiteralExpression(writers) || !ts.isArrayLiteralExpression(locations))
      throw new Error(`A registration lacks a literal id, writers, or locations: ${element.getText().slice(0, 200)}`)
    const name = String(literal(id, 'A registration id'))
    return {
      id: name,
      writers: writers.elements.map(writer => String(literal(writer, `A writer of ${name}`))),
      locations: locations.elements.map((location) => {
        if (!ts.isObjectLiteralExpression(location))
          throw new Error(`A location of ${name} is not an object literal: ${location.getText()}`)
        return Object.fromEntries(location.properties.map((property) => {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name))
            throw new Error(`A location of ${name} has a computed property: ${property.getText()}`)
          return [property.name.text, literal(property.initializer, `A location of ${name}`)]
        }))
      }),
    }
  })
}

/** A site whose key the scan cannot resolve, or whose prefix no single location covers, with the registration that owns it. */
export interface DynamicSite {
  file: string
  registration: string
  /** Why the key cannot be a constant. */
  reason: string
}

interface Match {
  registration: RegistrySource
  location: RegistryLocation
}

function siteMatches(site: StorageWriteSite, location: RegistryLocation): boolean {
  const { key } = site
  if (location.area !== site.area)
    return false
  if (site.area === 'indexedDB') {
    if (!('database' in key) || location.database !== key.database)
      return false
    if (!('store' in location))
      return key.store === undefined || location.legacy === true
    if (key.store === undefined || location.store !== key.store)
      return false
    // A driver with a `base` reaches only the locations under it; one without reaches the whole store.
    const prefix = typeof location.prefix === 'string' ? location.prefix : ''
    return !key.prefix || prefix.startsWith(key.prefix) || key.prefix.startsWith(prefix)
  }
  if (site.area === 'cacheStorage')
    return 'exact' in key && location.cache === key.exact
  if ('exact' in key)
    return location.key === key.exact || location.perModel === key.exact || (typeof location.prefix === 'string' && key.exact.startsWith(location.prefix))
  if ('prefix' in key && !('database' in key))
    return typeof location.prefix === 'string' && key.prefix.startsWith(location.prefix)
  if ('perModel' in key)
    return location.perModel === key.perModel
  return false
}

function describeKey(key: StorageWriteKey): string {
  if ('database' in key)
    return `database '${key.database}' store '${key.store ?? '?'}'${key.prefix ? ` prefix '${key.prefix}'` : ''}`
  if ('exact' in key)
    return `'${key.exact}'`
  if ('prefix' in key)
    return `prefix '${key.prefix}'`
  if ('perModel' in key)
    return `per-model key '${key.perModel}'`
  return `unresolved key \`${key.unresolved}\``
}

/**
 * The problems of each write site, one message each. A site fails when its key matches no location, when a write
 * matches a `legacy` location, or when its file is not a writer of the registration that owns the key (rule 6).
 * Unresolved keys and prefixes that no location covers are owned through `dynamicSites`, and OPFS sites through the
 * writers of an OPFS location, by file. IndexedDB drivers are mounts that several repositories share, so they skip rule 6.
 */
export function checkStorageWrites(sites: readonly StorageWriteSite[], registry: readonly RegistrySource[], dynamicSites: readonly DynamicSite[]): string[] {
  const problems: string[] = []
  for (const site of sites) {
    const where = `${site.file}:${site.line}`
    // OPFS directory names are built at run time, so an OPFS site is owned by file: its file writes an OPFS location.
    if (site.area === 'opfs') {
      if (!registry.some(registration => registration.writers.includes(site.file) && registration.locations.some(location => location.area === 'opfs')))
        problems.push(`${where}: ${site.file} opens OPFS but is not a writer of a registration with an OPFS location.`)
      continue
    }
    const matches: Match[] = registry.flatMap(registration => registration.locations.filter(location => siteMatches(site, location)).map(location => ({ registration, location })))
    if (!matches.length) {
      const dynamic = dynamicSites.find(entry => entry.file === site.file)
      const owner = dynamic && registry.find(registration => registration.id === dynamic.registration)
      if (!dynamic) {
        problems.push(`${where}: ${site.area} ${site.operation} of ${describeKey(site.key)} matches no registration in the state registry. Register the key in packages/stage-ui/src/persistence/state-registry.ts, or, when the key cannot be a constant, add the site to the dynamic sites of scripts/dev-tools/storage-writes.test.ts.`)
      }
      else if (!owner?.locations.some(location => location.area === site.area)) {
        problems.push(`${where}: the dynamic site entry names ${dynamic.registration}, which has no ${site.area} location.`)
      }
      else if (!owner.writers.includes(site.file)) {
        problems.push(`${where}: ${site.file} is not a writer of ${owner.id}, which the dynamic sites name for it.`)
      }
      continue
    }
    if (site.operation === 'write' && matches.some(match => match.location.legacy === true))
      problems.push(`${where}: ${site.area} write of ${describeKey(site.key)} matches a legacy location of ${matches[0].registration.id}. Only an older release may write it.`)
    // An IndexedDB driver can reach several registrations of one store; it is a writer when it writes for any of them.
    const owners = [...new Set(matches.map(match => match.registration))]
    if (!owners.some(owner => owner.writers.includes(site.file)) && site.area !== 'indexedDB')
      problems.push(`${where}: ${site.file} writes ${describeKey(site.key)}, which ${owners.map(owner => owner.id).join(', ')} owns, but is not one of its writers (rule 6: one owner per key).`)
  }
  return problems
}

/** Reads a repository file under `root`, or `undefined` when it does not exist. */
export function repositoryReader(root: string): ReadRepositoryFile {
  return (path) => {
    try {
      return readFileSync(join(root, path), 'utf8')
    }
    catch {
      return undefined
    }
  }
}
