import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const workspace = new URL('..', import.meta.url)
const tokenPattern = /\bsk-[A-Za-z0-9_-]{20,}\b/u
const candidates = new Set()

const tracked = spawnSync('git', ['ls-files', '-z'], {
  cwd: workspace,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (tracked.status !== 0) process.exit(tracked.status ?? 1)
for (const path of tracked.stdout.split('\0')) {
  if (path) candidates.add(path)
}

function collect(path, relativePath) {
  if (!existsSync(path)) return
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) collect(join(path, entry), join(relativePath, entry))
    return
  }
  if (stat.isFile()) candidates.add(relativePath)
}

for (const directory of ['dist', 'server-dist']) {
  collect(join(workspace.pathname, directory), directory)
}

const leakedPaths = []
for (const relativePath of candidates) {
  const absolutePath = join(workspace.pathname, relativePath)
  if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) continue
  if (tokenPattern.test(readFileSync(absolutePath, 'utf8'))) leakedPaths.push(relativePath)
}

const history = spawnSync(
  'git',
  ['log', '--all', '--format=%H', '-Gsk-[A-Za-z0-9_-]{20,}', '--', '.'],
  { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
)
if (history.status !== 0) process.exit(history.status ?? 1)
const leakedCommits = [...new Set(history.stdout.trim().split('\n').filter(Boolean))]

if (leakedPaths.length || leakedCommits.length) {
  if (leakedPaths.length) console.error(`credential-shaped value found in: ${leakedPaths.join(', ')}`)
  if (leakedCommits.length) console.error(`credential-shaped value found in git commits: ${leakedCommits.join(', ')}`)
  process.exit(1)
}

console.log(`credential leak check passed (${candidates.size} files, git history)`)
