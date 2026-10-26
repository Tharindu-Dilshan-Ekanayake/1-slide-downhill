import { Vector3 } from 'three'

/**
 * Floating "+12 POWER" text: a fixed pool of DOM elements (max 10 alive), positioned
 * by projecting a world point each frame. When the pool is full the oldest popup is
 * recycled, so a fast treadmill can never pile up elements.
 *
 * A popup can also sit off its point on screen and drift (in reference pixels, see
 * spawnAround): that's how the ones round a rider spread out instead of stacking.
 */

export const POPUP_POOL_SIZE = 10
const LIFE_MS = 1150
const RISE = 1.4
const DEFAULT_GRADIENT = 'linear-gradient(180deg, #fffaa8 0%, #ffd52a 45%, #ff9c00 100%)'

/** @type {Array<{ el: HTMLElement, texts: HTMLElement[], icon: HTMLImageElement, active: boolean, born: number, life: number, pos: Vector3, scale: number }>} */
const pool = []
const _v = new Vector3()

/** Called by PopupLayer once its elements exist. */
export function registerPopupElements(elements) {
  pool.length = 0
  for (const el of elements) {
    if (!el) continue
    pool.push({
      el,
      texts: [...el.querySelectorAll('[data-popup-text]')],
      icon: el.querySelector('img'),
      // What the DOM currently shows, so spawning only writes what changed: setting an
      // img src (even to the same data URL) or a gradient restyles and re-decodes.
      shown: { text: null, gradient: null, iconUrl: undefined },
      active: false,
      born: 0,
      life: LIFE_MS,
      pos: new Vector3(),
      /** Set for popups that ride along with something moving; `pos` is then relative to it. */
      follow: null,
      scale: 1,
      /** Screen offset from the point, and how far it drifts over its life (reference px). */
      ox: 0,
      oy: 0,
      dx: 0,
      dy: 0,
      /** Tilt in degrees; `rise` is false for drifting popups (they don't float up in the world). */
      rot: 0,
      rise: true,
    })
  }
}

/**
 * @param {string} text
 * @param {{ x: number, y: number, z: number }} position world point to rise from
 * @param {{ iconUrl?: string, scale?: number, gradient?: string, life?: number,
 *   follow?: Vector3, ox?: number, oy?: number, dx?: number, dy?: number, rot?: number }} [style]
 *   no `iconUrl` = text only; `follow` keeps the popup where it started relative to that
 *   (moving) point, e.g. a rider going down the hill. `ox`/`oy` put it off the point on
 *   screen and `dx`/`dy` drift it (reference pixels; it then doesn't rise); `rot` tilts it.
 */
export function spawnPopup(text, position, style = {}) {
  if (pool.length === 0) return
  let slot = pool.find((p) => !p.active)
  if (!slot) slot = pool.reduce((oldest, p) => (p.born < oldest.born ? p : oldest), pool[0])
  slot.active = true
  slot.born = performance.now()
  slot.life = style.life || LIFE_MS
  slot.scale = style.scale || 1
  slot.pos.set(position.x, position.y, position.z)
  slot.follow = style.follow || null
  if (slot.follow) slot.pos.sub(slot.follow)
  slot.ox = style.ox || 0
  slot.oy = style.oy || 0
  slot.dx = style.dx || 0
  slot.dy = style.dy || 0
  slot.rot = style.rot || 0
  slot.rise = !(style.dx || style.dy)
  const shown = slot.shown
  if (shown.text !== text) {
    shown.text = text
    for (const t of slot.texts) t.textContent = text
  }
  const gradient = style.gradient || DEFAULT_GRADIENT
  if (slot.texts[1] && shown.gradient !== gradient) {
    shown.gradient = gradient
    slot.texts[1].style.backgroundImage = gradient
  }
  const iconUrl = style.iconUrl || null
  if (slot.icon && shown.iconUrl !== iconUrl) {
    shown.iconUrl = iconUrl
    slot.icon.style.display = iconUrl ? '' : 'none'
    if (iconUrl) slot.icon.src = iconUrl
  }
  // Hidden until the next frame places it, so it never shows at the corner first.
  slot.el.style.opacity = '0'
  slot.el.style.display = 'flex'
}

// --- Round a rider -------------------------------------------------------------------

/** Popups round a rider fan out over this arc above them (screen angles, degrees; up is -90). */
const ARC_FROM = -175
const ARC_SPAN = 170
/** How far out they appear (reference px), and how much further they drift. */
const RING_MIN = 135
const RING_SPREAD = 90
const DRIFT = 55
let ringIndex = 0
/** Reused style for spawnAround: it's called a few times a second, never per frame. */
const ringStyle = { iconUrl: null, scale: 1, gradient: null, life: 0, follow: null, ox: 0, oy: 0, dx: 0, dy: 0, rot: 0 }

/**
 * A popup round something moving (a rider): at the next spot of a golden-ratio sequence
 * over the arc above it, so consecutive popups land well apart, then drifting outwards
 * and up as it fades. `center` is followed; the popup is pinned `lift` metres above it.
 *
 * @param {string} text
 * @param {Vector3} center the moving point (kept by reference)
 * @param {number} lift metres above `center` the ring is centred on
 * @param {{ iconUrl?: string, scale?: number, gradient?: string, life?: number }} [style]
 */
export function spawnAround(text, center, lift, style = {}) {
  ringIndex += 1
  const a = ((ARC_FROM + ((ringIndex * 0.618034) % 1) * ARC_SPAN) * Math.PI) / 180
  const r = RING_MIN + ((ringIndex * 0.381966) % 1) * RING_SPREAD
  // A wider ring than tall: the screen is wide and text is wider than it is high.
  const cx = Math.cos(a)
  const cy = Math.sin(a)
  ringStyle.iconUrl = style.iconUrl || null
  ringStyle.scale = style.scale || 1
  ringStyle.gradient = style.gradient || null
  ringStyle.life = style.life || 1050
  ringStyle.follow = center
  ringStyle.ox = cx * r * 1.65
  ringStyle.oy = cy * r
  ringStyle.dx = cx * DRIFT
  ringStyle.dy = cy * DRIFT * 0.6 - 30
  ringStyle.rot = cx * -9 + (Math.random() - 0.5) * 6
  _v.copy(center).y += lift
  spawnPopup(text, _v, ringStyle)
}

/** Positions every live popup. Runs inside the frame loop; touches only DOM styles. */
export function updatePopups(camera, width, height) {
  const now = performance.now()
  // One reference pixel on this screen, as the HUD's --px works it out.
  const px = Math.min(1.4, Math.max(0.42, Math.min(width / 1920, height / 1080)))
  for (const p of pool) {
    if (!p.active) continue
    const t = (now - p.born) / p.life
    if (t >= 1) {
      p.active = false
      p.el.style.display = 'none'
      continue
    }
    _v.copy(p.pos)
    if (p.follow) _v.add(p.follow)
    if (p.rise) _v.y += t * RISE
    _v.project(camera)
    if (_v.z > 1) {
      p.el.style.opacity = '0'
      continue
    }
    // Drift eases out: quick away from the rider, then hanging there as it fades.
    const drift = 1 - (1 - t) * (1 - t)
    const x = (_v.x * 0.5 + 0.5) * width + (p.ox + p.dx * drift) * px
    const y = (-_v.y * 0.5 + 0.5) * height + (p.oy + p.dy * drift) * px
    // Pop in, hold, fade out.
    const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : t < 0.22 ? 1.15 - ((t - 0.12) / 0.1) * 0.15 : 1
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
    p.el.style.opacity = String(fade)
    p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${p.rot}deg) scale(${pop * p.scale})`
  }
}
