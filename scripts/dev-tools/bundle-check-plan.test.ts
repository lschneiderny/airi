import { describe, expect, it } from 'vitest'

import { checkEagerChunks, entryScripts, staticImports } from './bundle-check-plan'

const html = '<head><script type="module" crossorigin src="./assets/main-a1.js"></script><link rel="modulepreload" href="./assets/vendor-b2.js"></head>'

describe('bundle check', () => {
  it('reads the module entry scripts of a window', () => {
    expect(entryScripts(html)).toEqual(['./assets/main-a1.js'])
  })

  it('collects static imports and re-exports, not dynamic imports', () => {
    const code = '/*! license */\nimport{a as b}from"./vendor-b2.js";import"./style-c3.js";export*from"./shared-d4.js";\nimport { c } from "../up-g7.js";\nconst s=()=>import("./MMD-e5.js");'
    expect(staticImports(code)).toEqual(['./vendor-b2.js', './style-c3.js', './shared-d4.js', '../up-g7.js'])
  })

  it('reads the header after the Vite dynamic-import helper', () => {
    const code = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./settings-k1.js"])))=>i.map(i=>d[i]);\nimport { a } from "./vendor-b2.js";\nconst s=()=>__vitePreload(()=>import("./settings-k1.js"),__vite__mapDeps([0]));'
    expect(staticImports(code)).toEqual(['./vendor-b2.js'])
  })

  it('ignores import text after the header, such as library strings and import.meta', () => {
    const code = 'import{a}from"./vendor-b2.js";const u=import.meta.url;const doc="import x from \'./types.js\'";export{u};'
    expect(staticImports(code)).toEqual(['./vendor-b2.js'])
  })

  it('reports three reached through static imports', () => {
    const chunks = new Map([
      ['assets/main-a1.js', 'import{x}from"./vendor-b2.js";const m=()=>import("./MMD-e5.js");'],
      ['assets/vendor-b2.js', 'window.__THREE__="180";export const x=1'],
      ['assets/MMD-e5.js', ''],
    ])
    expect(checkEagerChunks(html, chunks)).toEqual({ eager: ['assets/main-a1.js', 'assets/vendor-b2.js'], heavy: ['assets/vendor-b2.js'], missing: [] })
  })

  it('passes when three loads only on demand, and reports missing chunks', () => {
    const chunks = new Map([
      ['assets/main-a1.js', 'import"./gone-f6.js";const m=()=>import("./three.core-e5.js");'],
      ['assets/three.core-e5.js', 'window.__THREE__="180"'],
    ])
    expect(checkEagerChunks(html, chunks)).toEqual({ eager: ['assets/main-a1.js'], heavy: [], missing: ['assets/gone-f6.js'] })
  })
})
