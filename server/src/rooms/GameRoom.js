import { Room } from '@colyseus/core'

import { boardScores } from '../../../shared/bloxityBoards.js'
import { applyOfflineProgress } from '../../../shared/logic.js'
import { PlayerSession } from '../../../shared/session.js'
import { clampToWalkable, isSlideReturn, MAX_MOVE_SPEED, SPAWN } from '../../../shared/world.js'
import { queueScores, verifyGameToken } from '../bloxity.js'
import { carryGuestProgress, getSphinxStock, loadProfile, saveProfile, takeSphinx } from '../db.js'
import { getLeaderboards } from '../leaderboards.js'
import { activePlayers, broadcastAll, liveRooms } from '../registry.js'
import { GameState, PlayerState } from './schema.js'

const MAX_CLIENTS = 8
const RECONNECT_SECONDS = 20
const AUTOSAVE_MS = 30_000
/** State patches to clients, and the training simulation, per second. */
const PATCH_HZ = 15
const SIM_HZ = 10
/** Allowance on top of max speed for a position update to be accepted. */
const MOVE_SLACK = 2.5
/** Close code used when the same player joins somewhere else (4000-4010 are Colyseus's own). */
const DUPLICATE_LOGIN = 4100
/** Names this server process in save ownership; Legion sets POD_NAME per pod. */
const POD = process.env.POD_NAME || `local-${process.pid}`

/** Boxity emote ids are 24-character catalogue ids. */
const EMOTE_ID = /^[a-z0-9]{24}$/i
/** Guests are `guest-<id>`: the only ids a client may claim without a Boxity token. */
const GUEST_ID = /^guest-[\w-]{6,74}$/

/** What other players may be told someone is doing. */
const ANIMS = ['idle', 'walk', 'run', 'jump', 'slide']

/** Unambiguous characters for lobby codes people read out to each other. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = (length = 5) =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

const cleanName = (name) =>
  String(name || 'Player')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 20) || 'Player'

/**
 * One lobby: up to 8 players sharing a world. All game rules run in each player's
 * PlayerSession; the room handles networking, position validation, persistence and
 * the small shared state other players render from.
 */
export class GameRoom extends Room {
  maxClients = MAX_CLIENTS
  autoDispose = true

  /**
   * sessionId -> { session, playerId, owner, lastPos, lastPosAt, kicked?, reconnection? }
   * `owner` claims the player's save for this session (see db.js).
   */
  members = new Map()

  onCreate(options = {}) {
    this.setState(new GameState())
    if (options.private) {
      // A short code friends can type instead of the long generated room id.
      this.roomId = makeCode()
      this.state.code = this.roomId
      this.state.isPrivate = true
      this.setPrivate(true)
    }
    this.setPatchRate(1000 / PATCH_HZ)
    this.setSimulationInterval((dt) => this.tick(dt / 1000), 1000 / SIM_HZ)
    this.updateListing()
    liveRooms.add(this)

    // Everything the client can ask for goes through the player's session.
    this.onMessage('*', (client, type, payload) => {
      if (type === 'pos') return this.handlePosition(client, payload)
      if (type === 'look') return this.handleLook(client, payload)
      if (type === 'emote') return this.handleEmote(client, payload)
      const member = this.members.get(client.sessionId)
      if (!member) return
      member.session.handle(String(type), payload || {}, Date.now())
      this.syncPlayer(client.sessionId)
    })

    this.autosave = setInterval(() => this.saveAll(), AUTOSAVE_MS)
  }

  /**
   * Who is joining. A signed-in player sends their Boxity session token, verified with
   * Boxity: their save is their Boxity account id, and the guest saves this browser
   * played before signing in may carry over (onJoin). Without a token a client can only
   * be a guest (`guest-<random>`), so it can only ever reach its own guest save.
   */
  async onAuth(_client, options) {
    const name = cleanName(options?.name)
    const guestId = GUEST_ID.test(String(options?.guestId || '')) ? String(options.guestId) : null
    const token = typeof options?.token === 'string' ? options.token : ''
    if (token) {
      const verified = await verifyGameToken(token)
      if (verified?.valid && verified.user?._id) {
        const legionId = String(verified.user._id)
        const carryFrom = [
          // Boxity guest accounts (a CrazyGames guest has a session too, saved under its
          // id), then this browser's own guest save.
          ...(Array.isArray(verified.carriedFrom) ? verified.carriedFrom.slice(0, 5).map(String) : []),
          ...(guestId ? [guestId] : []),
        ]
        return { playerId: legionId, legionId, name, carryFrom }
      }
      if (verified) throw new Error('Your Boxity session has expired - please sign in again.')
      // Boxity couldn't be asked. Locally, trust the claimed id so development works
      // offline; deployed, never.
      if (process.env.NODE_ENV !== 'production' && options?.playerId) {
        const legionId = String(options.playerId).slice(0, 80)
        return { playerId: legionId, legionId, name, carryFrom: [] }
      }
      throw new Error('Could not check your Boxity session - try again in a moment.')
    }
    const playerId = String(options?.playerId || '')
    if (!GUEST_ID.test(playerId)) throw new Error('Sign in, or play as a guest.')
    return { playerId, legionId: '', name, carryFrom: [] }
  }

  async onJoin(client, _options, auth) {
    const { playerId, legionId, name, carryFrom } = client.auth || auth

    // Same account joining again (a refresh, a new tab, a reconnect the old session
    // hasn't noticed yet): the newest connection wins. The old one is saved and removed
    // at once, even when it's only a seat held open for a reconnect - otherwise a
    // frozen copy of the player would stand in the lobby until that ran out.
    const existing = activePlayers.get(playerId)
    if (existing) await existing.room.evict(existing.client, 'You joined from another window.')

    const now = Date.now()
    const owner = `${POD}:${client.sessionId}`
    if (carryFrom?.length) await carryGuestProgress(playerId, carryFrom, name, owner)
    const profile = await loadProfile(playerId, name, owner)
    const offline = applyOfflineProgress(profile, now)

    const player = new PlayerState()
    const spawnX = SPAWN.x + (Math.random() - 0.5) * 6
    const spawnZ = SPAWN.z + (Math.random() - 0.5) * 4
    Object.assign(player, { name, uid: legionId || '', x: spawnX, y: 0, z: spawnZ, rotY: Math.PI, anim: 'idle' })
    this.state.players.set(client.sessionId, player)

    const session = new PlayerSession(profile, {
      now,
      emit: (type, payload) => client.send(type, payload),
      getPosition: () => player,
      onPurchase: (productId) => {
        if (productId !== 'sphinx') return true
        const ok = takeSphinx()
        if (ok) broadcastAll('stock', { sphinx: getSphinxStock() })
        return ok
      },
      onSlide: (result) => {
        this.broadcast(
          'ghostSlide',
          { sid: client.sessionId, distance: result.distance, duration: result.duration, boardId: profile.equippedBoard, x: player.x, z: player.z },
          { except: client },
        )
      },
    })

    this.members.set(client.sessionId, { session, playerId, legionId, owner, lastPos: { x: spawnX, z: spawnZ }, lastPosAt: now })
    activePlayers.set(playerId, { room: this, client })

    session.sendProfile()
    client.send('spawn', { x: spawnX, z: spawnZ })
    client.send('stock', { sphinx: getSphinxStock() })
    client.send('leaderboards', getLeaderboards())
    if (offline) client.send('offline', offline)
    this.syncPlayer(client.sessionId)
    this.updateListing()
  }

  /** Dropped without saying goodbye (mobile network blip): hold the seat. */
  async onDrop(client) {
    const member = this.members.get(client.sessionId)
    if (!member || member.kicked) return
    // Stop training while away; the seat stays warm for the reconnect.
    member.session.handle('leaveTreadmill', {}, Date.now())
    member.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    try {
      await member.reconnection
    } catch {
      // Window expired, or the player came back as a new session (evict); onLeave
      // cleans up.
    } finally {
      member.reconnection = null
    }
  }

  onReconnect(client) {
    const member = this.members.get(client.sessionId)
    if (!member) return
    activePlayers.set(member.playerId, { room: this, client })
    member.session.emit = (type, payload) => client.send(type, payload)
    member.session.sendProfile()
  }

  async onLeave(client) {
    const member = this.members.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member) {
      if (activePlayers.get(member.playerId)?.client === client) activePlayers.delete(member.playerId)
      this.members.delete(client.sessionId)
      this.reportScores(member)
      if (!member.kicked) await saveProfile(member.session.profile, member.owner)
    }
    this.updateListing()
  }

  /**
   * The pod is going away (a deploy, or scaling in): save everyone, then close with
   * SERVER_SHUTDOWN, which sends each client back through the matchmaker to a pod
   * that's staying.
   */
  async onBeforeShutdown() {
    await this.saveAll()
    super.onBeforeShutdown()
  }

  async onDispose() {
    clearInterval(this.autosave)
    liveRooms.delete(this)
    await this.saveAll()
  }

  // --- Helpers -----------------------------------------------------------------------

  /**
   * Saves and removes a player who has joined again elsewhere: gone from everyone's
   * view at once, and a seat held for their reconnect let go rather than left to run
   * out.
   */
  async evict(client, reason) {
    const member = this.members.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member && !member.kicked) {
      member.kicked = true
      await saveProfile(member.session.profile, member.owner)
      member.reconnection?.reject(new Error('replaced by a new session'))
    }
    try {
      client.send('kicked', { reason })
      client.leave(DUPLICATE_LOGIN)
    } catch {
      // Already disconnected (the held-seat case).
    }
  }

  saveAll() {
    for (const member of this.members.values()) this.reportScores(member)
    return Promise.all([...this.members.values()].map((m) => (m.kicked ? null : saveProfile(m.session.profile, m.owner))))
  }

  /** Queues a signed-in player's leaderboard scores, from the profile this server owns. */
  reportScores(member) {
    if (member.legionId && !member.kicked) queueScores(member.legionId, boardScores(member.session.profile))
  }

  /**
   * An emote Boxity's picker played on someone (only ids they own reach the game):
   * passed on to everyone else in the room, who play it on that player's character.
   */
  handleEmote(client, msg) {
    const id = String(msg?.id || '')
    if (!EMOTE_ID.test(id) || !this.state.players.has(client.sessionId)) return
    this.broadcast('emote', { sid: client.sessionId, id }, { except: client })
  }

  updateListing() {
    this.setMetadata({
      players: this.clients.length,
      isPrivate: Boolean(this.state.isPrivate),
      region: process.env.REGION || 'default',
    })
  }

  /** Copies the public bits of a profile into the synced state (only what changed). */
  syncPlayer(sessionId) {
    const member = this.members.get(sessionId)
    const player = this.state.players.get(sessionId)
    if (!member || !player) return
    const p = member.session.profile
    if (player.slide !== p.slide) player.slide = p.slide
    if (player.wins !== p.wins) player.wins = p.wins
    if (player.rebirths !== p.rebirths) player.rebirths = p.rebirths
    if (player.level !== p.level) player.level = p.level
    if (player.boardId !== p.equippedBoard) player.boardId = p.equippedBoard
    const pets = p.equippedPets
      .map((uid) => p.pets.find((pet) => pet.uid === uid)?.id)
      .filter(Boolean)
    if (pets.join() !== [...player.petIds].join()) {
      player.petIds.clear()
      for (const id of pets) player.petIds.push(id)
    }
  }

  /**
   * Position reports, ~10 Hz from each client. Accepted if the move is physically
   * possible since the last accepted one (or is the hop back to the top after a slide);
   * otherwise the client is snapped back.
   */
  handlePosition(client, msg) {
    const member = this.members.get(client.sessionId)
    const player = this.state.players.get(client.sessionId)
    if (!member || !player || !msg) return
    const x = Number(msg.x)
    const y = Number(msg.y)
    const z = Number(msg.z)
    if (![x, y, z].every(Number.isFinite)) return

    const now = Date.now()
    const dt = Math.max(0.05, (now - member.lastPosAt) / 1000)
    const dist = Math.hypot(x - member.lastPos.x, z - member.lastPos.z)
    if (dist > MAX_MOVE_SPEED * dt + MOVE_SLACK && !isSlideReturn(member.lastPos, { x, z })) {
      client.send('correct', { x: member.lastPos.x, y: player.y, z: member.lastPos.z })
      return
    }
    const clamped = clampToWalkable(x, z)
    member.lastPos = clamped
    member.lastPosAt = now
    player.x = clamped.x
    player.y = Math.max(0, Math.min(y, 6))
    player.z = clamped.z
    player.rotY = Number(msg.r) || 0
    player.anim = ANIMS.includes(msg.a) ? msg.a : 'idle'
  }

  /**
   * What a player's avatar wears, so everyone else can dress them the same. Purely
   * cosmetic, so trusted as sent, but kept to a small object of short strings and
   * plain numbers.
   */
  handleLook(client, msg) {
    const player = this.state.players.get(client.sessionId)
    if (!player || !msg || typeof msg !== 'object') return
    const clean = (obj, keep) => {
      const out = {}
      if (!obj || typeof obj !== 'object') return out
      for (const [key, value] of Object.entries(obj).slice(0, 24)) {
        if (key.length > 24) continue
        if (keep(value)) out[key] = value
      }
      return out
    }
    const look = JSON.stringify({
      equipped: clean(msg.equipped, (v) => (typeof v === 'string' && v.length <= 40) || (Number.isFinite(v) && Math.abs(v) < 1e12)),
      // Wide enough for every Boxity range (legOffsetX runs -0.7 to 5).
      proportions: clean(msg.proportions, (v) => Number.isFinite(v) && v > -1 && v < 6),
    })
    if (look.length <= 2048 && look !== player.look) player.look = look
  }

  tick(dt) {
    const now = Date.now()
    for (const [sessionId, member] of this.members) {
      member.session.tick(dt, now)
      this.syncPlayer(sessionId)
    }
  }
}
