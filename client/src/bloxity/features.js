import { SPAWN } from '@shared/world'
import { BOXITY_BOARDS } from '@shared/bloxityBoards'

import { setAdBreakMuted, setMasterVolume, setMusicVolume } from '../audio/sfx'
import { setChatBubblesEnabled, showChatBubble } from '../game/chatBubbles'
import { loadEmotes, playLocalEmote } from '../game/emotes'
import { runtime } from '../game/runtime'
import { slide } from '../game/slide/slideControl'
import { actions } from '../net/actions'
import { getGame } from '../store/game'
import { QUALITY_LEVELS, useQuality } from '../store/quality'
import { platform } from './platform'
import { safeCall, toUnsubscribe } from './sdk'

/** Boxity's graphics_quality values, onto the game's presets. */
const QUALITY = { Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH', Ultra: 'HIGH' }

/** Boxity's menu "Reset Character": back to spawn (not mid-slide, which ends on its own). */
function respawn() {
  if (slide.active) return
  runtime.player.position.set(SPAWN.x, 0, SPAWN.z)
  runtime.player.yaw = Math.PI
  runtime.camera.snap = true
}

/**
 * Wires the Boxity features the game supports, once, right after `Legion.SDK.init()`:
 * leaderboards, emotes, ad breaks, settings, player events and chat. Returns the
 * unsubscribe for everything it subscribed.
 *
 * @param {object} sdk `window.Legion.SDK`
 */
export function installBloxityFeatures(sdk) {
  const subs = []
  const on = (result) => subs.push(toUnsubscribe(result))

  // Leaderboards: declared once (this is also what shows Boxity's trophy button). The
  // scores themselves are reported by the game server, from the saves it owns.
  safeCall(sdk.leaderboard?.define?.bind(sdk.leaderboard), BOXITY_BOARDS)

  // Emotes: Boxity draws the picker; registering makes its button appear. On boot, not
  // after assets load.
  safeCall(sdk.game?.registerFeature?.bind(sdk.game), 'emotes')
  loadEmotes()

  // Ad breaks can start at any time: pause the game and silence it until they end.
  on(
    safeCall(sdk.ads?.onBreakStart?.bind(sdk.ads), () => {
      getGame().setAdBreak(true)
      setAdBreakMuted(true)
    }),
  )
  on(
    safeCall(sdk.ads?.onBreakEnd?.bind(sdk.ads), () => {
      getGame().setAdBreak(false)
      setAdBreakMuted(false)
    }),
  )

  // Settings (all strings). Listening also puts the control in Boxity's menu.
  const listen = (key, apply) => on(safeCall(sdk.settings?.listen?.bind(sdk.settings), key, (value) => safeCall(apply, String(value ?? ''))))
  const percent = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) / 100 : fallback
  }
  listen('master_volume', (v) => setMasterVolume(percent(v, 0.8)))
  listen('music_volume', (v) => setMusicVolume(percent(v, 0.8)))
  listen('enable_chat', (v) => setChatBubblesEnabled(v !== 'false'))
  let qualityTold = false
  listen('graphics_quality', (v) => {
    const level = QUALITY[v]
    if (!level) return
    const quality = useQuality.getState()
    // The first value is Boxity's default ("High") as often as a choice, so it can only
    // lower what the hardware check picked: a phone must not start on HIGH. Later
    // changes are the player's. Never marked manual, so the FPS monitor can still drop it.
    const told = qualityTold
    qualityTold = true
    if (!told && QUALITY_LEVELS.indexOf(level) >= QUALITY_LEVELS.indexOf(quality.level)) return
    if (level !== quality.level) quality.setLevel(level, false)
  })
  safeCall(sdk.settings?.triggerAll?.bind(sdk.settings))

  // Menu "Reset Character", and emotes from Boxity's picker.
  on(
    safeCall(sdk.player?.onEvent?.bind(sdk.player), (event, data) => {
      if (event === 'respawn_request') respawn()
      else if (event === 'play_emote' && typeof data === 'string') playLocalEmote(data, actions.emote)
    }),
  )

  // Chat: Boxity draws the chat box; the game shows each message over its sender.
  on(
    safeCall(sdk.chat?.onMessage?.bind(sdk.chat), (message) => {
      if (message && typeof message === 'object') showChatBubble(message, platform.bubbleText(message), platform.bubbleSeconds())
    }),
  )

  return () => subs.forEach((fn) => safeCall(fn))
}
