#!/usr/bin/env node
// Bump the project's semver minor by one (0.N.0 → 0.(N+1).0).
// Writes package.json and prints the new version so the caller can use it in a commit message.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgPath = join(here, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const parts = String(pkg.version).split('.').map((n) => Number.parseInt(n, 10))
if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
  console.error(`Cannot parse version: ${pkg.version}`)
  process.exit(1)
}
parts[1] += 1
parts[2] = 0
const next = parts.join('.')
pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(next)
