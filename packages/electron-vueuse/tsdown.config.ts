import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/main/index.ts',
  ],
  dts: true,
  format: 'esm',
  inlineOnly: false,
  // NOTICE:
  // The electron-eventa host capability contract imports its type from stage-shared.
  // The dts bundler inlines that source and rejects the type-only import as a missing value export.
  // Source: tsdown MISSING_EXPORT on HostCapabilities in electron-eventa/dist/*.d.mts.
  // Removal condition: delete when the dts bundler accepts type-only re-exports from inlined sources.
  deps: { neverBundle: [/^@proj-airi\/stage-shared/] },
})
