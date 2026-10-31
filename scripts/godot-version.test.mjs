import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The root global.json is the one Godot version pin. dotnet resolves Godot.NET.Sdk from it.
const root = fileURLToPath(new URL('..', import.meta.url))
const readText = path => readFileSync(`${root}${path}`, 'utf8')
const godotSdk = JSON.parse(readText('global.json'))['msbuild-sdks']['Godot.NET.Sdk']

describe('the Godot version pin', () => {
  it('engines/stage-tamagotchi-godot/stage-tamagotchi-godot.csproj takes Godot.NET.Sdk from global.json', () => {
    // The Godot editor writes its own version back into the Sdk attribute when it saves the project.
    expect(readText('engines/stage-tamagotchi-godot/stage-tamagotchi-godot.csproj')).toMatch(/<Project Sdk="Godot\.NET\.Sdk">/)
  })

  it('installs the same Godot editor through the engine mise.toml', () => {
    const tools = readText('engines/stage-tamagotchi-godot/mise.toml').split('[tools]')[1]
    expect(/^godot = "([^"]+)"$/m.exec(tools)?.[1]).toBe(`${godotSdk}-stable_mono`)
  })
})
