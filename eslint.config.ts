import slop from 'eslint-plugin-slop'

import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({
  masknet: false,
  perfectionist: false,
  preferArrow: false,
  sonarjs: false,
  sortPackageJsonScripts: false,
  typescript: true,
  unocss: true,
  vue: true,
}, {
  ignores: [
    'cspell.config.yaml',
    'cspell.config.yml',
    '**/assets/js/**',
    '**/assets/live2d/models/**',
    'apps/stage-tamagotchi/out/**',
    'apps/stage-tamagotchi/src/bindings/**',
    'apps/stage-tamagotchi-electron/out/**',
    'apps/stage-tamagotchi-electron/src/renderer/bindings/**',
    '**/drizzle/**',
    '**/.astro/**',
    'docs/superpowers/**',
    '.agents/**',
    '.github/**',
    'CLAUDE.md', // Skip the symbolic link
  ],
}, {
  name: 'airi/slop',
  files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}'],
  plugins: { slop },
  // Full inspection keeps editor and CI results independent of Git history.
  settings: { slop: { inspection: { mode: 'full' } } },
  rules: {
    'slop/max-comment-length': 'warn',
    'slop/no-chained-type-assertions': 'warn',
    // Product strings can use this punctuation.
    'slop/no-em-dash': 'off',
    'slop/no-jargon': 'warn',
    'slop/no-static-only-class': 'warn',
    'slop/no-trivial-functions': 'warn',
    // Named primitive aliases can express domain concepts.
    'slop/no-trivial-type-aliases': 'off',
    // The autofix workflow must preserve existing comment syntax.
    'slop/prefer-jsdoc': 'off',
  },
}, {
  rules: {
    'antfu/import-dedupe': 'error',
    // TODO: remove this
    'depend/ban-dependencies': 'warn',
    'import/order': 'off',
    'markdown/require-alt-text': 'off',
    'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    // Catches the manual `error instanceof Error ? error.message : ...`
    // pattern AGENTS.md forbids. The selector matches a ConditionalExpression
    // whose test is `<x> instanceof Error` and whose consequent is `<x>.message`,
    // so it does NOT false-positive on `error instanceof Error ? error : new Error(...)`
    // (where the consequent is the error itself, not its `.message`). Antfu's
    // default no-restricted-syntax patterns are preserved alongside.
    'no-restricted-syntax': [
      'error',
      {
        message: 'Avoid `error instanceof Error ? error.message : ...`. Use `errorMessageFrom(error)` from \'@moeru/std\' (or `errorMessageFromUnknown(error, fallback)` from \'@proj-airi/stage-shared\'). Pair with `?? \'fallback\'` when a default is needed.',
        selector: 'ConditionalExpression[test.type=\'BinaryExpression\'][test.operator=\'instanceof\'][test.right.name=\'Error\'][consequent.type=\'MemberExpression\'][consequent.property.name=\'message\']',
      },
      {
        message: 'Omit TypeScript and JavaScript source extensions from relative imports, dynamic imports, and re-exports.',
        selector: [
          'ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ExportNamedDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ExportAllDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ImportExpression[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
        ].join(', '),
      },
      'TSEnumDeclaration[const=true]',
      'TSExportAssignment',
    ],
    'pnpm/json-enforce-catalog': 'off',
    'pnpm/json-valid-catalog': 'off',
    'pnpm/yaml-enforce-settings': 'off',
    // 'sonarjs/cognitive-complexity': 'off',
    // 'sonarjs/no-commented-code': 'off',
    // 'sonarjs/pseudo-random': 'off',
    'style/padding-line-between-statements': 'error',
    'vue/prefer-separate-static-class': 'off',
    'yaml/plain-scalar': 'off',
  },
}, {
  files: ['packages/motion-driver-{natural,humanoid}/src/**', 'packages/stage-shared/src/stage-world/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['three', 'three/*', 'vue', 'pinia', '@moeru/three-mmd*', '@proj-airi/stage-ui*'],
          message: 'Motion driver packages must remain renderer-neutral.',
        },
      ],
    }],
  },
}, {
  // The eager Live2D path may import only the three-free 3D subpaths; scenes load through `import()`.
  // Pocket was retired. See docs/ai/adr/2026-11-04-lazy-3d-renderers.md.
  name: 'airi/lazy-3d-renderers',
  files: [
    'packages/{stage-ui,stage-layouts,stage-pages}/src/**/*.{ts,vue}',
    'apps/stage-{tamagotchi,web}/src/**/*.{ts,vue}',
  ],
  ignores: ['**/*.test.ts', '**/pages/devtools/**'],
  rules: {
    'ts/no-restricted-imports': ['error', {
      paths: ['@proj-airi/stage-ui-mmd', '@proj-airi/stage-ui-three'].map(name => ({
        name,
        allowTypeImports: true,
        message: 'The package root loads the 3D scene. Import a three-free subpath, or load the scene with defineAsyncComponent.',
      })),
      // Regular expressions, because gitignore-style groups cannot re-include a subpath of an excluded directory.
      patterns: [{
        regex: '^(?:three|@moeru/three-mmd|@pixiv/three-vrm|@tresjs/)',
        allowTypeImports: true,
        message: 'This library belongs to the 3D renderers. Load the code that needs it with a dynamic import().',
      }, {
        // The allowed subpaths are the three-free stores, constants, and helpers.
        regex: '^@proj-airi/stage-ui-(?:mmd|three)/(?!stores(?:/|$)|constants/|assets/|composables/mmd/overlay-flags$|composables/hit-test$)',
        allowTypeImports: true,
        message: 'This module loads three on the eager Live2D path. Load it with a dynamic import() instead.',
      }],
    }],
  },
}, {
  // Wayland detection has one owner: the host capability service resolves it once and publishes the snapshot.
  name: 'airi/host-capabilities',
  files: ['apps/stage-tamagotchi/src/**/*.{ts,vue}'],
  ignores: [
    'apps/stage-tamagotchi/src/main/app/ozone.ts',
    'apps/stage-tamagotchi/src/main/app/ozone.test.ts',
    'apps/stage-tamagotchi/src/main/index.ts',
    'apps/stage-tamagotchi/src/main/services/electron/host-capabilities.ts',
    'apps/stage-tamagotchi/src/main/services/electron/host-capabilities.test.ts',
  ],
  rules: {
    'ts/no-restricted-imports': ['error', {
      patterns: [{
        // Matches any specifier that names the ozone module: sibling (`./ozone`), relative from any depth
        // (`../../app/ozone`), and alias (`@/main/app/ozone`), with or without `.ts`.
        // `ozone.ts` is the only module with that name under apps/stage-tamagotchi/src.
        regex: '(^|/)ozone(\\.ts)?$',
        message: 'Do not detect Wayland per call site. Read the host capability snapshot from the host capability service (main/services/electron/host-capabilities.ts) instead.',
      }],
    }],
    // A rule entry replaces the earlier one, so the repo-wide `no-restricted-syntax` entries are repeated here.
    'no-restricted-syntax': [
      'error',
      {
        message: 'Avoid `error instanceof Error ? error.message : ...`. Use `errorMessageFrom(error)` from \'@moeru/std\' (or `errorMessageFromUnknown(error, fallback)` from \'@proj-airi/stage-shared\'). Pair with `?? \'fallback\'` when a default is needed.',
        selector: 'ConditionalExpression[test.type=\'BinaryExpression\'][test.operator=\'instanceof\'][test.right.name=\'Error\'][consequent.type=\'MemberExpression\'][consequent.property.name=\'message\']',
      },
      {
        message: 'Omit TypeScript and JavaScript source extensions from relative imports, dynamic imports, and re-exports.',
        selector: [
          'ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ExportNamedDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ExportAllDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ImportExpression[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
        ].join(', '),
      },
      {
        message: 'Do not detect Wayland per call site. Read the host capability snapshot from the host capability service (main/services/electron/host-capabilities.ts) instead.',
        // Covers literal specifiers, template literals whose static parts name ozone (including `${base}/ozone`),
        // and string concatenations. Fully computed specifiers such as `import(name)` cannot be decided statically.
        selector: [
          'ImportExpression[source.value=/(^|\\/)ozone(\\.ts)?$/]',
          'ImportExpression > TemplateLiteral.source > TemplateElement[value.raw=/ozone/]',
          'ImportExpression > TemplateLiteral.source > Literal[value=/ozone/]',
          'ImportExpression > BinaryExpression.source Literal[value=/ozone/]',
        ].join(', '),
      },
      'TSEnumDeclaration[const=true]',
      'TSExportAssignment',
    ],
  },
}, {
  files: ['server/apps/api/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        message: 'Do not mock internal project modules with vi.mock or vi.doMock. Inject the collaborator through the route, service, or factory boundary and pass a fake or spy in tests.',
        selector: 'CallExpression[callee.type=\'MemberExpression\'][callee.object.name=\'vi\'][callee.property.name=/^(mock|doMock)$/][arguments.0.type=\'Literal\'][arguments.0.value=/^(\\.|@proj-airi\\/|~)/]',
      },
      {
        message: 'Do not use vi.hoisted. If a test needs a collaborator spy, expose an explicit dependency injection point instead of hoisting module mocks.',
        selector: 'CallExpression[callee.type=\'MemberExpression\'][callee.object.name=\'vi\'][callee.property.name=\'hoisted\']',
      },
      {
        message: 'Omit TypeScript and JavaScript source extensions from relative imports, dynamic imports, and re-exports.',
        selector: [
          'ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ExportNamedDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ExportAllDeclaration[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
          'ImportExpression[source.value=/^\\.{1,2}\\/.*\\.[cm]?[jt]sx?$/]',
        ].join(', '),
      },
    ],
  },
}, {
  files: ['**/*.md'],
  rules: {
    // NOTICE:
    // These rules crash the whole lint run on a bare URL inside brackets.
    // The GFM autolink transform emits nodes without positions.
    // Source: https://github.com/eslint/markdown/issues/619
    // Removal condition: @eslint/markdown guards those nodes in these rules.
    'markdown/no-invalid-label-refs': 'off',
    'markdown/no-reference-like-urls': 'off',
    'markdown/no-space-in-emphasis': 'off',
  },
}, {
  ignores: [
    '**/*.md',
  ],
  rules: {
    'perfectionist/sort-imports': [
      'error',
      {
        groups: [
          'type-builtin',
          'type-import',
          'type-internal',
          ['type-parent', 'type-sibling', 'type-index'],
          'default-value-builtin',
          'named-value-builtin',
          'value-builtin',
          'default-value-external',
          'named-value-external',
          'value-external',
          'default-value-internal',
          'named-value-internal',
          'value-internal',
          ['default-value-parent', 'default-value-sibling', 'default-value-index'],
          ['named-value-parent', 'named-value-sibling', 'named-value-index'],
          ['wildcard-value-parent', 'wildcard-value-sibling', 'wildcard-value-index'],
          ['value-parent', 'value-sibling', 'value-index'],
          'side-effect',
          'style',
        ],
        newlinesBetween: 1,
      },
    ],
  },
})
