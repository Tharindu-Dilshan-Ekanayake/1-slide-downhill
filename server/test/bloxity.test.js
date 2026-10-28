import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boardScores } from '../../shared/bloxityBoards.js'
import { applySlide, createProfile, normalizeProfile } from '../../shared/logic.js'
import { carryGuestProgress, closeStorage, loadProfile, openStorage, saveProfile } from '../src/db.js'
import { GameRoom } from '../src/rooms/GameRoom.js'

test('without a Boxity token a client can only be a guest', async () => {
  const room = new GameRoom()
  const guest = await room.onAuth(null, { playerId: 'guest-1234abcd', name: 'Ann' })
  assert.equal(guest.playerId, 'guest-1234abcd')
  assert.equal(guest.legionId, '')
  await assert.rejects(room.onAuth(null, { playerId: '64f0c0ffee0000000000abcd', name: 'Mallory' }), /guest/)
})

test('Wins earned count every Wins gain, and old saves start from what they hold', () => {
  const p = createProfile('a', 'A')
  const before = p.stats.winsEarned
  const result = applySlide(p, 0)
  assert.equal(p.stats.winsEarned, before + result.wins)
  const old = normalizeProfile({ wins: 1234, stats: { slides: 3 } }, 'b', 'B')
  assert.equal(old.stats.winsEarned, 1234)
  assert.deepEqual(boardScores({ ...old, rebirths: 2, stats: { ...old.stats, playtime: 125 } }), [
    ['wins', 1234],
    ['playtime', 2],
    ['rebirths', 2],
  ])
})

test('a first sign-in carries a guest save over once, and never onto an existing one', async () => {
  await openStorage({ mongoUri: '', path: ':memory:' })
  try {
    const guest = createProfile('guest-carry01', 'Guest')
    guest.wins = 777
    await saveProfile(guest, 'o')

    assert.equal(await carryGuestProgress('acct-1', ['guest-missing', 'guest-carry01'], 'Ann', 'o'), true)
    assert.equal((await loadProfile('acct-1', 'Ann', 'o')).wins, 777)
    // Used: a second account can't take it too.
    assert.equal(await carryGuestProgress('acct-2', ['guest-carry01'], 'Bob', 'o'), false)
    // An account with progress keeps its own.
    const own = createProfile('acct-3', 'Cy')
    own.wins = 5
    await saveProfile(own, 'o')
    const other = createProfile('guest-carry02', 'Guest')
    other.wins = 999
    await saveProfile(other, 'o')
    assert.equal(await carryGuestProgress('acct-3', ['guest-carry02'], 'Cy', 'o'), false)
    assert.equal((await loadProfile('acct-3', 'Cy', 'o')).wins, 5)
  } finally {
    await closeStorage()
  }
})
