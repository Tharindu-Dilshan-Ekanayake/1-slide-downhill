import cors from 'cors'
import express from 'express'
import { defineRoom, defineServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'

import { BLOXITY, flushScores, portalHost, startScoreReports, verifyGameToken } from './bloxity.js'
import { closeStorage, openStorage, recordGemsGrant } from './db.js'
import { startLeaderboards } from './leaderboards.js'
import { activePlayers } from './registry.js'
import { GameRoom } from './rooms/GameRoom.js'

// Bloxity Legion injects PORT (HTTP and WebSocket share it); 2567 is Colyseus's usual.
const PORT = Number(process.env.PORT || 2567)

/**
 * Browser origins allowed to call /api: Legion's CLIENT_ORIGIN (the game's site), the
 * Bloxity-hosted frontends of this environment (under stage.bloxity.io on stage),
 * extra ones from CLIENT_ORIGINS, and Vite dev servers.
 */
const ALLOWED_ORIGINS = [
  process.env.CLIENT_ORIGIN,
  BLOXITY.portalUrl,
  `https://${BLOXITY.gameId}.play.${portalHost()}`,
  `https://${BLOXITY.gameId}.dev.play.${portalHost()}`,
  ...(process.env.CLIENT_ORIGINS || '').split(',').map((s) => s.trim()),
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://localhost:5180', 'http://127.0.0.1:5180']),
].filter(Boolean)

/** HTTP endpoints next to the Colyseus matchmaker on the same port. */
function routes(app) {
  // Legion's readiness and liveness probes. Answers at once, whatever else is going on.
  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', cors({ origin: ALLOWED_ORIGINS, credentials: true }))
  app.use('/api', express.json())

  app.get('/api/health', (_req, res) => {
    // `game` lets a development client tell this server from another project's.
    res.json({ ok: true, game: 'slide', players: activePlayers.size })
  })

  /**
   * `Legion.SDK.auth.authenticateWithServer('/api/legion-auth')`: POSTs `{ token, user }`.
   * The answer comes from the token as Boxity verifies it, never from the posted user.
   * (The game itself verifies the token when a player joins a room; see GameRoom.onAuth.)
   */
  app.post('/api/legion-auth', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''
    const verified = token ? await verifyGameToken(token) : { valid: false }
    if (!verified) return res.status(503).json({ error: 'Could not check the session' })
    if (!verified.valid || !verified.user?._id) return res.status(401).json({ error: 'Invalid session' })
    res.json({ user: { legionId: String(verified.user._id), username: verified.user.username } })
  })

  /**
   * Gems purchases, delivered by Boxity server to server. Must answer 2xx or the Gems
   * are refunded. Can land on any pod, so the grant is recorded in the database by
   * transaction id (once), never looked up in one pod's memory. The game sells nothing
   * for Gems yet: grants are recorded, and a sku would be applied from that record.
   */
  app.post('/api/bloxity/gems', async (req, res) => {
    const secret = process.env.LEGION_WEBHOOK_SECRET
    if (secret && req.get('x-legion-webhook-secret') !== secret) return res.status(401).json({ error: 'Bad secret' })
    const body = req.body || {}
    if (!body.transactionId || !body.userId || !body.sku) return res.status(400).json({ error: 'Missing transactionId, userId or sku' })
    try {
      const fresh = await recordGemsGrant(String(body.transactionId), {
        userId: String(body.userId),
        sku: String(body.sku),
        productPrice: body.productPrice,
        metadata: body.metadata ?? null,
        timestamp: body.timestamp ?? Date.now(),
      })
      if (fresh) console.log(`[gems] recorded ${body.transactionId}: ${body.sku} for ${body.userId}`)
      res.json({ ok: true })
    } catch (err) {
      console.error('[gems] could not record a grant', err)
      res.status(500).json({ error: 'Could not record the grant' })
    }
  })
}

await openStorage()

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    game: defineRoom(GameRoom).enableRealtimeListing(),
  },
  express: routes,
  greet: false,
})

// SIGTERM (a deploy or scale-in) runs Colyseus' graceful shutdown: every room saves
// and hands its players to another pod (GameRoom.onBeforeShutdown), then this.
server.onShutdown(async () => {
  await flushScores()
  await closeStorage()
})

await server.listen(PORT)
startLeaderboards()
startScoreReports()
console.log(`[server] listening on port ${PORT}${process.env.POD_NAME ? ` (${process.env.POD_NAME}, ${process.env.BLOXITY_CHANNEL})` : ''}, Boxity ${BLOXITY.env}`)
