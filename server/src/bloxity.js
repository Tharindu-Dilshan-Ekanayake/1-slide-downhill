import { BOXITY_BOARDS } from '../../shared/bloxityBoards.js'

/**
 * Talking to Boxity from the server: which environment this deploy is in, verifying a
 * player's session, and reporting leaderboard scores.
 *
 * Boxity hosting injects the environment on every deploy; the fallbacks (prod) only
 * apply when a variable is missing, e.g. in local development.
 */
export const BLOXITY = {
  env: process.env.BLOXITY_ENV || 'prod',
  apiUrl: (process.env.BLOXITY_API_URL || 'https://api.bloxity.io').replace(/\/+$/, ''),
  matchmakerUrl: (process.env.BLOXITY_MATCHMAKER_URL || 'https://play.bloxity.io').replace(/\/+$/, ''),
  portalUrl: (process.env.BLOXITY_PORTAL_URL || 'https://bloxity.io').replace(/\/+$/, ''),
  staticUrl: (process.env.BLOXITY_STATIC_URL || 'https://static.bloxity.io').replace(/\/+$/, ''),
  /** The hosting id, which is also the game's slug on Boxity. */
  gameId: process.env.BLOXITY_GAME_ID || '1-slide-downhill',
}

/** The portal's own host (bloxity.io, or stage.bloxity.io on stage), for the game's play hosts. */
export const portalHost = () => {
  try {
    return new URL(BLOXITY.portalUrl).host
  } catch {
    return 'bloxity.io'
  }
}

const VERIFY_TIMEOUT_MS = 5000

/**
 * Checks a player's Boxity session token (`Legion.SDK.auth.getToken()`).
 *
 * Resolves to `{ valid, user, carriedFrom? }` as Boxity answers it (`carriedFrom`: up
 * to five Boxity guest ids this browser played as before signing in), or null when
 * Boxity couldn't be asked at all (network, outage).
 */
export async function verifyGameToken(token) {
  try {
    const res = await fetch(`${BLOXITY.apiUrl}/v1/auth/game-token/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameSlug: BLOXITY.gameId }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    if (res.status === 401 || res.status === 403) return { valid: false }
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.warn('[bloxity] token verification unavailable', err?.message || err)
    return null
  }
}

/**
 * Leaderboard scores, batched: each player's latest score per board is kept here and
 * sent every REPORT_MS (and when asked to flush). Only signed-in Boxity players
 * (`legion_<id>`) are reported. Without BLOXITY_REPORT_TOKEN (local development)
 * nothing is sent.
 */
const REPORT_MS = 20_000
const MAX_SCORES = 200
const pending = new Map()

/** Queues `scores` (`[boardId, score]`) for the Boxity account `userId`. */
export function queueScores(userId, scores) {
  if (!process.env.BLOXITY_REPORT_TOKEN || !userId) return
  const id = `legion_${String(userId).replace(/^legion_/, '').replace(/#m.*$/, '')}`
  for (const [board, score] of scores) {
    if (Number.isFinite(score)) pending.set(`${id}\n${board}`, { board, userId: id, score })
  }
}

export async function flushScores() {
  const token = process.env.BLOXITY_REPORT_TOKEN
  if (!token || pending.size === 0) return
  const batch = [...pending.values()]
  pending.clear()
  for (let i = 0; i < batch.length; i += MAX_SCORES) {
    const scores = batch.slice(i, i + MAX_SCORES)
    try {
      const res = await fetch(`${BLOXITY.apiUrl}/v1/leaderboards/hosted/${encodeURIComponent(BLOXITY.gameId)}/report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boards: BOXITY_BOARDS, scores }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) console.warn(`[bloxity] leaderboard report failed (${res.status})`, body)
      else if (body?.dropped && Object.values(body.dropped).some(Boolean)) console.warn('[bloxity] leaderboard scores dropped', body.dropped)
    } catch (err) {
      console.warn('[bloxity] leaderboard report failed', err?.message || err)
    }
  }
}

export function startScoreReports() {
  const id = setInterval(flushScores, REPORT_MS)
  return () => clearInterval(id)
}
