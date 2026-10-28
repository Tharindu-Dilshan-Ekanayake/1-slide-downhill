/**
 * Name tags over other players: a fixed pool of DOM elements (one per possible
 * remote player) positioned from the frame loop, like the power popups.
 */

/** One per possible remote player, plus one for your own chat bubble. */
export const NAMEPLATE_POOL_SIZE = 9

const pool = []

/**
 * Each tag is a container holding an outline copy and a fill copy of the name, and a
 * chat bubble above them (`[data-bubble]`).
 */
export function registerNameplateElements(elements) {
  pool.length = 0
  for (const el of elements) {
    if (!el) continue
    const bubble = el.querySelector('[data-bubble]')
    pool.push({ el, copies: [...el.querySelectorAll('[data-name]')], bubble, bubbleText: '', text: '', shown: false })
  }
}

/** Shows slot `i` at screen (x, y) with `text`, and `bubble` over it if any; null x hides it. */
export function placeNameplate(i, text, x, y, alpha = 1, bubble = '') {
  const slot = pool[i]
  if (!slot) return
  if (x === null) {
    if (slot.shown) {
      slot.el.style.display = 'none'
      slot.shown = false
    }
    return
  }
  if (slot.text !== text) {
    slot.text = text
    for (const copy of slot.copies) copy.textContent = text
  }
  if (slot.bubble && slot.bubbleText !== bubble) {
    slot.bubbleText = bubble
    slot.bubble.textContent = bubble
    // '' falls back to the stylesheet's clamped two-line box.
    slot.bubble.style.display = bubble ? '' : 'none'
  }
  if (!slot.shown) {
    slot.el.style.display = 'block'
    slot.shown = true
  }
  slot.el.style.opacity = String(alpha)
  slot.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
}

export function hideNameplatesFrom(start) {
  for (let i = start; i < pool.length; i += 1) placeNameplate(i, '', null)
}
