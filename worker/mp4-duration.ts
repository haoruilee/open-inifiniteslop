type Mp4Box = {
  type: string
  payloadStart: number
  end: number
}

function fourCc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function boxAt(view: DataView, offset: number, limit: number): Mp4Box | null {
  if (offset + 8 > limit) return null
  let size = view.getUint32(offset)
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > limit) return null
    const extendedSize = view.getBigUint64(offset + 8)
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(extendedSize)
    headerSize = 16
  } else if (size === 0) {
    size = limit - offset
  }
  if (size < headerSize || offset + size > limit) return null
  return { type: fourCc(view, offset + 4), payloadStart: offset + headerSize, end: offset + size }
}

/** Reads the movie-header duration from a complete ISO BMFF / MP4 file. */
export function mp4DurationSeconds(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  let moov: Mp4Box | null = null
  while (offset < view.byteLength) {
    const box = boxAt(view, offset, view.byteLength)
    if (!box) return null
    if (box.type === 'moov') {
      moov = box
      break
    }
    offset = box.end
  }
  if (!moov) return null

  offset = moov.payloadStart
  while (offset < moov.end) {
    const box = boxAt(view, offset, moov.end)
    if (!box) return null
    if (box.type === 'mvhd') {
      if (box.payloadStart + 4 > box.end) return null
      const version = view.getUint8(box.payloadStart)
      const timescaleOffset = box.payloadStart + (version === 1 ? 20 : 12)
      const durationOffset = box.payloadStart + (version === 1 ? 24 : 16)
      if (timescaleOffset + 4 > box.end || durationOffset >= box.end) return null
      const timescale = view.getUint32(timescaleOffset)
      if (timescale === 0) return null
      const duration = version === 1
        ? view.getBigUint64(durationOffset)
        : BigInt(view.getUint32(durationOffset))
      const seconds = Number(duration) / timescale
      return Number.isFinite(seconds) && seconds > 0 && seconds <= 3_600
        ? Math.round(seconds * 1_000) / 1_000
        : null
    }
    offset = box.end
  }
  return null
}
