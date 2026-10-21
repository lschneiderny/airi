// NOTICE:
// Type-checks the Vue single-file components that stage-ui-live2d re-exports from its barrel.
// tsc cannot resolve ".vue" imports and this package has no vue-tsc step.
// Source: packages/stage-ui-live2d/src/index.ts; removal: when typecheck switches to vue-tsc.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent
  export default component
}
