/**
 * Boxity chat as speech bubbles: Boxity draws the chat itself and hands the game every
 * message in the room (sender verified, text already filtered); the game shows each
 * player's latest one above their name tag for a few seconds.
 *
 * Keyed by the sender's Boxity account id (matched to other players through their
 * synced `uid`), or 'local' for your own. A newer message replaces the last.
 */

const DEFAULT_SECONDS = 4
/** key -> { text, until } */
const bubbles = new Map()
let enabled = true

/** Boxity's enable_chat setting: off hides every bubble. */
export function setChatBubblesEnabled(on) {
  enabled = on
  if (!on) bubbles.clear()
}

/**
 * @param {{ userId: string, isLocalPlayer?: boolean }} message
 * @param {string} text what to show (the SDK's bubbleText)
 * @param {number} [seconds]
 */
export function showChatBubble(message, text, seconds = DEFAULT_SECONDS) {
  if (!enabled || !text) return
  const key = message.isLocalPlayer ? 'local' : String(message.userId || '').replace(/^legion_/, '')
  if (key) bubbles.set(key, { text, until: performance.now() + seconds * 1000 })
}

/** The bubble to show over `key` right now, or '' (expired ones are dropped). */
export function bubbleFor(key, now) {
  if (!key) return ''
  const bubble = bubbles.get(key)
  if (!bubble) return ''
  if (now > bubble.until) {
    bubbles.delete(key)
    return ''
  }
  return bubble.text
}
