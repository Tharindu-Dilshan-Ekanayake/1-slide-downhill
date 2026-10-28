import { getSDK, safeCall } from './sdk'

/**
 * The bits of the Boxity SDK gameplay and networking code call, behind one module so
 * nothing else reaches for `window.Legion`. Every call is a no-op without the SDK
 * (offline, or the script blocked), so callers never need to check.
 */
const call = (ns, fn, ...args) => {
  const target = getSDK()?.[ns]
  return safeCall(target?.[fn]?.bind(target), ...args)
}

let screen = null
let screenType = ''

export const platform = {
  /** Inside a Boxity page (iframe)? Boxity's toolbar then handles accounts. */
  isEmbedded: () => Boolean(call('portal', 'isEmbeddedInLegion')),
  /** The signed-in player's session token for the game server, or null. */
  token: () => call('auth', 'getToken') || null,

  /** The room friends can join you in; '' in menus or offline. */
  updateRoom: (roomId) => call('game', 'updateRoom', roomId || ''),
  /** From the netcode: someone joined after you (shows Boxity's friend-join toast)... */
  playerJoined: (username) => username && call('game', 'playerJoined', username),
  /** ...or was already there when you did. */
  playerInRoom: (username) => username && call('game', 'playerInRoom', username),
  gameplayStart: () => call('game', 'gameplayStart'),
  gameplayEnd: () => call('game', 'gameplayEnd'),

  /**
   * Which screen is showing, for Boxity's banner ads round it: 'menu' | 'lobby' |
   * 'results' | 'panel' | 'gameplay', or null when none. One at a time; a new one
   * replaces the last. Outside Boxity it does nothing.
   */
  screen(type) {
    if (type === screenType) return
    screenType = type || ''
    if (!type) {
      safeCall(screen?.hide?.bind(screen))
      screen = null
      call('ads', 'hideScreen')
      return
    }
    screen = call('ads', 'screen', type) || null
  },

  /** What a chat message reads as in a bubble (two short lines, or 'sent a GIF'). */
  bubbleText: (message) => call('chat', 'bubbleText', message) || String(message?.text || '').slice(0, 80),
  bubbleSeconds: () => getSDK()?.chat?.bubbleSeconds || 4,
}
