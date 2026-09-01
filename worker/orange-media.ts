/**
 * A provider may return either a public signed CDN URL or an Orange gateway
 * URL. Only the latter is allowed to receive the Orange credential again.
 */
export function requiresOrangeGatewayAuth(apiBase: string, mediaUrl: string) {
  try {
    const gateway = new URL(apiBase)
    const media = new URL(mediaUrl)
    if (gateway.protocol !== 'https:' || media.protocol !== 'https:') return false
    if (media.hostname === gateway.hostname) return true
    return gateway.hostname === 'api.orangeapi.chat' && media.hostname === 'orangeapi.chat'
  } catch {
    return false
  }
}
