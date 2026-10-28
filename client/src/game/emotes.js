import { Euler, Quaternion } from 'three'

import { bloxityEnv } from '../bloxity/env'
import { runtime } from './runtime'

/**
 * Boxity emotes. Boxity draws the picker itself and tells the game which one to play
 * (`play_emote`, only ids the player owns); the game plays it on the character and
 * replicates it through the room.
 *
 * The catalogue (`{apiUrl}/v1/avatar/emotes`) is fetched once: each emote's `clip` is
 * `{ len, loop, tracks }`, tracks mapping a bone name to `[[time, xDeg, yDeg, zDeg], ...]`
 * - degree deltas over the bind pose, euler XYZ, right-multiplied onto the bone's bind
 * rotation, smoothstepped between keys.
 */

/** id -> clip */
const clips = new Map()
let loading = null

/** Fetches the catalogue once; resolves when it's in (or failed - emotes then do nothing). */
export function loadEmotes() {
  if (!loading) {
    loading = fetch(`${bloxityEnv().apiUrl}/v1/avatar/emotes`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => {
        const list = Array.isArray(body) ? body : body?.emotes || body?.items || []
        for (const emote of list) {
          if (emote?.id && emote.clip?.tracks && Number(emote.clip.len) > 0) clips.set(String(emote.id), emote.clip)
        }
      })
      .catch((err) => console.warn('[emotes] catalogue unavailable', err))
  }
  return loading
}

/**
 * An emote someone started: `{ id, startedAt }`. Unknown ids are ignored silently.
 * Resolves once the catalogue is in, so a play_emote that beat it still plays.
 */
export async function startEmote(id) {
  await loadEmotes()
  return clips.has(id) ? { id, startedAt: performance.now() } : null
}

/** Plays emote `id` on your own character; `send` replicates it to the room. */
export async function playLocalEmote(id, send) {
  const emote = await startEmote(String(id))
  if (!emote) return
  runtime.emote = emote
  send?.(emote.id)
}

const BLEND_S = 0.1

/**
 * Advances one avatar's emote playback (`state`, kept per avatar) towards `active`
 * (the emote it should be doing, or null): blends in over ~0.1 s, out when it stops or
 * a one-shot clip ends. Returns `state` while anything is showing, else null.
 */
export function stepEmote(state, active, now, delta) {
  if (active && active.id !== state.id) {
    const clip = clips.get(active.id)
    if (clip) Object.assign(state, { id: active.id, clip, startedAt: active.startedAt })
  }
  if (!state.clip) return null
  state.time = (now - state.startedAt) / 1000
  const playing = Boolean(active) && active.id === state.id && (state.clip.loop || state.time < state.clip.len)
  state.weight = Math.min(1, Math.max(0, state.weight + ((playing ? 1 : -1) * delta) / BLEND_S))
  if (!playing && state.weight === 0) {
    state.id = ''
    state.clip = null
    return null
  }
  return state
}

/** A fresh per-avatar playback state for stepEmote. */
export const createEmoteState = () => ({ id: '', clip: null, startedAt: 0, time: 0, weight: 0 })

const DEG = Math.PI / 180
const _euler = new Euler()
const _target = new Quaternion()
const _out = [0, 0, 0]

/** The clip's x, y, z degrees for `keys` at time `t`, written into `_out` (no allocation). */
function sample(keys, t) {
  const first = keys[0]
  const last = keys[keys.length - 1]
  // Clamped outside the keys.
  if (t <= first[0] || keys.length === 1) return copyKey(first)
  if (t >= last[0]) return copyKey(last)
  let i = 0
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i += 1
  const a = keys[i]
  const b = keys[i + 1]
  const span = b[0] - a[0]
  let s = span > 0 ? (t - a[0]) / span : 1
  s = s * s * (3 - 2 * s)
  for (let k = 0; k < 3; k += 1) _out[k] = (a[k + 1] || 0) + ((b[k + 1] || 0) - (a[k + 1] || 0)) * s
  return _out
}

function copyKey(key) {
  for (let k = 0; k < 3; k += 1) _out[k] = key[k + 1] || 0
  return _out
}

/**
 * Poses `rig` (from collectRig) for emote playback `state`, blended over whatever pose
 * is on the bones by `state.weight`. Bones the rig doesn't have are ignored.
 */
export function applyEmote(rig, state) {
  const { clip } = state
  const t = clip.loop ? state.time % clip.len : Math.min(state.time, clip.len)
  for (const name in clip.tracks) {
    const entry = rig.bones[name]
    const keys = clip.tracks[name]
    if (!entry || !Array.isArray(keys) || keys.length === 0) continue
    const v = sample(keys, t)
    _target.setFromEuler(_euler.set(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'XYZ'))
    _target.premultiply(entry.origQuat)
    entry.bone.quaternion.slerp(_target, state.weight)
  }
}
