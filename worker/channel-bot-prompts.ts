const worlds = [
  'an endless airport terminal floating inside a purple storm cloud',
  'a giant teacup city revolving inside a glass snow globe',
  'a transparent subway crossing a desert of velvet dunes',
  'a moonlit vending machine growing coral trees',
  'a neon monastery on the back of a turtle-shaped cloud',
  'a floating supermarket where fruit orbits in miniature solar systems',
  'a toy-sized opera house folded from glowing paper',
  'a deep-sea laundromat washed by jellyfish constellations',
  'a mechanical sunflower field surrounding a mirror lake',
  'a retro television tower rising from an ocean of luminous foam',
  'a tiny moon hotel carried by dozens of illuminated kites',
  'a city of hot-air balloons nested inside a giant seashell',
  'a rain-soaked arcade built on drifting lotus leaves',
  'a library train traveling through crystal caves',
  'a bakery on a floating asteroid',
  'a museum of tiny weather systems inside glass domes',
] as const

const surrealEvents = [
  'where staircases gently spiral into the sky',
  'while miniature clouds pour colored light into every window',
  'as paper birds rearrange the street lamps',
  'with rivers flowing upward into glowing glass bowls',
  'where friendly robots dance with umbrella-shaped trees',
  'as distant planets drift between apartment balconies',
  'with clock hands turning into ribbons of light',
  'where fish swim through the air in slow circles',
  'as glowing luggage carts move by themselves',
  'with a quiet rain of tiny lanterns',
  'where windows open into other seasons',
  'as confetti blossoms float in slow motion',
  'with every shadow moving a beat behind',
  'as miniature doors migrate across the walls',
  'where constellations spill across the floor like water',
  'while train tracks gently weave themselves into new patterns',
] as const

const cameraMoves = [
  'slow orbiting camera move',
  'wide-angle dolly through the scene',
  'gentle low tracking shot',
  'soft crane move over the foreground',
  'dreamy forward glide through layered depth',
  'calm panoramic sweep',
  'macro-to-wide reveal',
  'floating point-of-view drift',
] as const

const palettes = [
  'magenta and cyan dawn',
  'warm amber mist',
  'electric blue twilight',
  'soft peach and violet glow',
  'emerald moonlight',
  'saturated candy colors',
  'iridescent silver haze',
  'golden after-rain reflections',
] as const

export const channelBotPromptCycleLength = worlds.length * surrealEvents.length * cameraMoves.length * palettes.length

export function channelBotPromptFor(slot: number) {
  const normalizedSlot = Number.isSafeInteger(slot) ? Math.abs(slot) : 0
  const worldIndex = normalizedSlot % worlds.length
  const eventIndex = Math.floor(normalizedSlot / worlds.length) % surrealEvents.length
  const cameraIndex = Math.floor(normalizedSlot / (worlds.length * surrealEvents.length)) % cameraMoves.length
  const paletteIndex = Math.floor(normalizedSlot / (worlds.length * surrealEvents.length * cameraMoves.length)) % palettes.length

  return `${worlds[worldIndex]}, ${surrealEvents[eventIndex]}, ${cameraMoves[cameraIndex]}, ${palettes[paletteIndex]}, surreal cinematic motion, no text.`
}
