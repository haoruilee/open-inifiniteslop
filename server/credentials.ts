import { execFileSync } from 'node:child_process'

export const orangeKeychainAccount = 'orangeapi-production'
export const orangeKeychainService = 'open-inifiniteslop.orangeapi'
export const canonicalOrangeApiBase = 'https://api.orangeapi.chat/v1'

type CredentialLookupOptions = {
  platform?: NodeJS.Platform
  keychainLookup?: () => string
}

function systemKeychainLookup() {
  return execFileSync('/usr/bin/security', [
    'find-generic-password',
    '-a',
    orangeKeychainAccount,
    '-s',
    orangeKeychainService,
    '-w',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    killSignal: 'SIGKILL',
  })
}

export function resolveOrangeApiKey(
  environmentValue: string | null,
  apiBase = canonicalOrangeApiBase,
  options: CredentialLookupOptions = {},
) {
  const deploymentValue = environmentValue?.trim()
  if (deploymentValue) return deploymentValue
  const normalizedBase = apiBase.replace(/\/+$/u, '')
  if (normalizedBase === canonicalOrangeApiBase && (options.platform ?? process.platform) === 'darwin') {
    try {
      const keychainValue = (options.keychainLookup ?? systemKeychainLookup)().trim()
      if (keychainValue) return keychainValue
    } catch {
      // Deployment secret managers remain the fallback when Keychain is unavailable.
    }
  }
  return null
}
