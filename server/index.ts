import { createChannelHttpApp } from './app.js'
import { loadConfig } from './config.js'
import { ChannelDatabase } from './database.js'

const config = loadConfig()
const database = new ChannelDatabase(config.databasePath, { provider: config.provider })
const app = createChannelHttpApp(database, config)

app.server.listen(config.port, config.host, () => {
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
    await app.close()
  } finally {
    database.close()
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
