import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChannelSnapshot } from './types.js'

type Client = {
  response: ServerResponse
}

function writeEvent(response: ServerResponse, snapshot: ChannelSnapshot) {
  response.write(`id: ${snapshot.revision}\n`)
  response.write('event: state\n')
  response.write(`data: ${JSON.stringify(snapshot)}\n\n`)
}

export class SseHub {
  private readonly clients = new Map<string, Client>()
  private readonly heartbeat: NodeJS.Timeout

  constructor(heartbeatMs = 20_000) {
    this.heartbeat = setInterval(() => {
      for (const { response } of this.clients.values()) response.write(': heartbeat\n\n')
    }, heartbeatMs)
    this.heartbeat.unref()
  }

  get size() {
    return this.clients.size
  }

  subscribe(
    request: IncomingMessage,
    response: ServerResponse,
    snapshot: () => ChannelSnapshot,
    onChange?: () => void,
  ) {
    const id = randomUUID()
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()
    this.clients.set(id, { response })
    writeEvent(response, snapshot())
    onChange?.()

    const remove = () => {
      if (!this.clients.delete(id)) return
      onChange?.()
    }
    request.once('close', remove)
    response.once('close', remove)
  }

  broadcast(snapshot: ChannelSnapshot) {
    for (const [id, { response }] of this.clients) {
      if (response.destroyed || response.writableEnded) {
        this.clients.delete(id)
        continue
      }
      writeEvent(response, snapshot)
    }
  }

  close() {
    clearInterval(this.heartbeat)
    for (const { response } of this.clients.values()) {
      response.write('event: shutdown\ndata: {}\n\n')
      response.end()
    }
    this.clients.clear()
  }
}
