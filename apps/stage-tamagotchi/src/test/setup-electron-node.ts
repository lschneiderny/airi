import process from 'node:process'

// Main-process tests run in plain Node, which lacks Electron's `process.getSystemVersion`. Tests of version-dependent
// capabilities mock `node:process` with their own version; every other test gets this fixed one.
Object.defineProperty(process, 'getSystemVersion', { value: () => '14.2.0', configurable: true, writable: true })
