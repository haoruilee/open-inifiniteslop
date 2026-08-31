import { createChannelHttpApp } from './app.js'
import { loadConfig } from './config.js'
import { ChannelDatabase } from './database.js'
import { ChannelOrchestrator } from './orchestrator.js'
import { createVideoProvider } from './video-provider.js'

const config = loadConfig()
const database = new ChannelDatabase(config.databasePath, { provider: config.provider })
const app = createChannelHttpApp(database, config)
const provider = createVideoProvider(config)
const orchestrator = new ChannelOrchestrator(database, provider, {
  generationConcurrency: config.generationConcurrency,
  bufferTarget: config.bufferTarget,
  workerIntervalMs: config.workerIntervalMs,
  rotationIntervalMs: config.rotationIntervalMs,
}, app.broadcast)

app.server.listen(config.port, config.host, () => {
  orchestrator.start()
  console.info(JSON.stringify({
    event: 'server_listening',
    host: config.host,
    port: config.port,
    provider: config.provider,
  }))
})

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  console.info(JSON.stringify({ event: 'server_shutdown', signal }))
  try {
    await orchestrator.stop()
    await app.close()
  } finally {
    database.close()
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
