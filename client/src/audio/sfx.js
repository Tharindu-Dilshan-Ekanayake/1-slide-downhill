import { createMusic } from './music'

/**
 * Sound effects and the background music, synthesised with WebAudio: no audio files
 * to download.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is created on
 * the first tap/click/key (which also starts the music) and every sound before that is
 * silently skipped.
 */

const MUTE_KEY = 'pp.muted'

let ctx = null
let master = null
let noiseBuffer = null
let music = null
let muted = readMuted()
const lastPlayed = new Map()
const muteListeners = new Set()

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume()
    return
  }
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return
  ctx = new Ctor()
  master = ctx.createGain()
  master.gain.value = muted ? 0 : 0.5
  master.connect(ctx.destination)
  // One second of white noise, reused by every whoosh and crack.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  music = createMusic(ctx, master, noiseBuffer)
  music.start()
}

/** Installs the first-gesture unlock. Call once at startup. */
export function installAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchend']
  const handler = () => {
    unlock()
    for (const e of events) window.removeEventListener(e, handler, true)
  }
  for (const e of events) window.addEventListener(e, handler, true)
  // Mobile browsers suspend audio in the background; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended') ctx.resume()
  })
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // Not persisted; fine.
  }
  if (master) master.gain.value = muted ? 0 : 0.5
  for (const listener of muteListeners) listener(muted)
}

/** Calls `listener(muted)` on every change; returns the unsubscribe. */
export function onMutedChange(listener) {
  muteListeners.add(listener)
  return () => muteListeners.delete(listener)
}

// --- Wind: the rush of air while you slide -----------------------------------------

let wind = null
let windSetAt = 0

/**
 * A looping band of filtered noise. `windSet(level)` (0..1, from your speed down the
 * hill) opens it up and brightens it; the music ducks under it until `windStop`.
 */
function windStart() {
  if (!ctx || wind || ctx.state !== 'running') return
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 0.7
  filter.frequency.value = 400
  const gain = ctx.createGain()
  gain.gain.value = 0.0001
  src.connect(filter).connect(gain).connect(master)
  src.start()
  wind = { src, filter, gain }
  music?.duck(true)
}

function windSet(level) {
  if (!wind) return
  // Ten updates a second is plenty for a smooth swell.
  const now = performance.now()
  if (now - windSetAt < 100) return
  windSetAt = now
  const t = ctx.currentTime
  const l = Math.min(1, Math.max(0, level))
  wind.gain.gain.setTargetAtTime(0.03 + l * 0.2, t, 0.2)
  wind.filter.frequency.setTargetAtTime(320 + l * 2400, t, 0.25)
}

function windStop() {
  if (!wind) return
  const { src, gain } = wind
  wind = null
  gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3)
  src.stop(ctx.currentTime + 1.5)
  music?.duck(false)
}

function ready(name, minGapMs = 0) {
  if (!ctx || muted || ctx.state !== 'running') return false
  const now = performance.now()
  if (minGapMs && now - (lastPlayed.get(name) || 0) < minGapMs) return false
  lastPlayed.set(name, now)
  return true
}

/** A short enveloped oscillator note. */
function tone(freq, { type = 'sine', at = 0, duration = 0.12, volume = 0.3, slideTo = null } = {}) {
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(master)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

/** Filtered noise: whooshes and cracks. */
function noise({ at = 0, duration = 0.3, volume = 0.25, from = 400, to = 2400, q = 1.2 } = {}) {
  const t = ctx.currentTime + at
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + duration)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + duration * 0.3)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(gain).connect(master)
  src.start(t, Math.random() * 0.5)
  src.stop(t + duration + 0.02)
}

export const sfx = {
  click() {
    if (ready('click', 40)) tone(660, { type: 'triangle', duration: 0.05, volume: 0.15 })
  },
  /** A Slide gain: a bright tick, softer for the ones that trickle in down the hill. */
  gain(sliding = false) {
    if (ready('gain', 110)) tone(880 + Math.random() * 120, { type: 'triangle', duration: 0.07, volume: sliding ? 0.05 : 0.07, slideTo: 1400 })
  },
  levelUp() {
    if (!ready('levelUp')) return
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'square', at: i * 0.07, duration: 0.14, volume: 0.09 }))
  },
  /** Pushing off down the hill: a whoosh and a rising boing. */
  slideStart() {
    if (!ready('slideStart')) return
    noise({ duration: 0.6, volume: 0.3, from: 250, to: 2600 })
    tone(220, { type: 'triangle', duration: 0.3, volume: 0.09, slideTo: 660 })
  },
  /** The board popping out in front of you when you press SLIDE: a springy bloop. */
  boardPop() {
    if (!ready('boardPop', 200)) return
    tone(420, { type: 'sine', duration: 0.16, volume: 0.14, slideTo: 980 })
    tone(1320, { type: 'triangle', at: 0.08, duration: 0.1, volume: 0.06 })
  },
  /** Flying off a ramp: a rising rush of air. */
  jumpWhoosh() {
    if (ready('jumpWhoosh', 250)) noise({ duration: 0.4, volume: 0.18, from: 500, to: 2600, q: 0.9 })
  },
  /** The board slapping back down after a jump. */
  boardLand() {
    if (!ready('boardLand', 250)) return
    tone(170, { type: 'sine', duration: 0.16, volume: 0.16, slideTo: 70 })
    noise({ duration: 0.18, volume: 0.12, from: 1600, to: 300, q: 0.7 })
  },
  trophy() {
    if (!ready('trophy', 90)) return
    tone(1319, { type: 'triangle', duration: 0.08, volume: 0.1 })
    tone(1760, { type: 'triangle', at: 0.06, duration: 0.1, volume: 0.1 })
  },
  wins() {
    if (!ready('wins')) return
    ;[988, 1319, 1568, 1976].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.06, duration: 0.18, volume: 0.13 }))
  },
  crack() {
    if (!ready('crack', 150)) return
    noise({ duration: 0.12, volume: 0.35, from: 1800, to: 600, q: 0.8 })
    tone(220, { type: 'square', duration: 0.08, volume: 0.08, slideTo: 90 })
  },
  reveal() {
    if (!ready('reveal')) return
    ;[392, 523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.06, duration: 0.22, volume: 0.12 }))
  },
  buy() {
    if (!ready('buy')) return
    tone(1047, { type: 'square', duration: 0.07, volume: 0.08 })
    tone(1568, { type: 'square', at: 0.08, duration: 0.16, volume: 0.08 })
  },
  error() {
    if (ready('error', 200)) tone(160, { type: 'sawtooth', duration: 0.18, volume: 0.07, slideTo: 110 })
  },
  rebirth() {
    if (!ready('rebirth')) return
    noise({ duration: 0.8, volume: 0.15, from: 200, to: 4000, q: 0.6 })
    ;[262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, { type: 'sawtooth', at: 0.1 + i * 0.07, duration: 0.25, volume: 0.06 }))
  },
  /** Stepping onto an unlocked treadmill: a soft rising chime. */
  treadmillEnter() {
    if (!ready('treadmillEnter', 400)) return
    ;[523, 784, 1047].forEach((f, i) => tone(f, { type: 'sine', at: i * 0.05, duration: 0.28, volume: 0.07 }))
  },
  /** A jump: a springy little boing. */
  jump() {
    if (ready('jump', 120)) tone(260, { type: 'triangle', duration: 0.18, volume: 0.1, slideTo: 620 })
  },
  /** Landing from a jump: a soft thump. */
  jumpLand() {
    if (!ready('jumpLand', 150)) return
    tone(140, { type: 'sine', duration: 0.12, volume: 0.12, slideTo: 70 })
    noise({ duration: 0.08, volume: 0.06, from: 900, to: 300, q: 0.7 })
  },
  /** Coming to a stop at the end of a slide: a scrape and a thud. */
  slideStop() {
    if (!ready('slideStop')) return
    tone(120, { type: 'sine', duration: 0.25, volume: 0.18, slideTo: 55 })
    noise({ duration: 0.5, volume: 0.14, at: 0.04, from: 1400, to: 250, q: 0.6 })
  },
  windStart,
  windSet,
  windStop,
}
