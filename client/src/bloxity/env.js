/**
 * Which Boxity environment this page is in - prod, stage or local - and its URLs.
 *
 * The platform tells the game, never the other way round: never work it out from the
 * page's own hostname, the referrer or a build flag. Boxity injects `window.BLOXITY_ENV`
 * into the pages it serves, an embedding portal tells the SDK in its handshake, and
 * `Legion.SDK.environment()` returns whichever it was told. A page nobody told anything
 * (served elsewhere) runs against prod.
 *
 * This is the one place Boxity's host names are written down: build every Boxity URL
 * from `bloxityEnv()`.
 *
 * Plain module, no browser-only imports at the top level: vite.config.js imports the
 * two presets below for the dev-server injection.
 */

/** @typedef {{ env: 'prod'|'stage'|'local', apiUrl: string, playUrl: string, portalUrl: string, staticUrl: string }} BloxityEnv */

/** @type {BloxityEnv} What a page nobody told anything runs against. */
export const PROD_ENV = Object.freeze({
  env: 'prod',
  apiUrl: 'https://api.bloxity.io',
  playUrl: 'https://play.bloxity.io',
  portalUrl: 'https://bloxity.io',
  staticUrl: 'https://static.bloxity.io',
})

/** @type {BloxityEnv} A standalone page against a Boxity platform running on this machine. */
export const LOCAL_ENV = Object.freeze({
  env: 'local',
  apiUrl: 'http://localhost:4000',
  playUrl: 'http://localhost:2567',
  portalUrl: 'http://localhost:3000',
  staticUrl: 'https://static.bloxity.io',
})

const KEYS = ['apiUrl', 'playUrl', 'portalUrl', 'staticUrl']
const trim = (url) => String(url).replace(/\/+$/, '')

/** A complete environment from `raw`, or null if anything is missing. */
function parse(raw) {
  if (!raw || typeof raw !== 'object' || !['prod', 'stage', 'local'].includes(raw.env)) return null
  if (!KEYS.every((key) => typeof raw[key] === 'string' && raw[key])) return null
  return { env: raw.env, ...Object.fromEntries(KEYS.map((key) => [key, trim(raw[key])])) }
}

/**
 * The told environment: from the SDK once it's loaded (it also knows what an embedding
 * portal said), else `window.BLOXITY_ENV`, else prod.
 *
 * @returns {BloxityEnv}
 */
export function bloxityEnv() {
  if (typeof window === 'undefined') return PROD_ENV
  try {
    const fromSdk = parse(window.Legion?.SDK?.environment?.())
    if (fromSdk) return fromSdk
  } catch {
    // An SDK without environment(): fall through.
  }
  return parse(window.BLOXITY_ENV) || PROD_ENV
}
