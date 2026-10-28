/**
 * The game's Boxity leaderboards, declared once by the client (Legion.SDK.leaderboard
 * .define, which also shows Boxity's trophy button) and with every server report.
 *
 * Ids and settings are permanent once Boxity has seen them: later edits here are
 * ignored, the developer changes a board in the Boxity dashboard instead.
 *
 * The scores come from the server, from the profile it owns (see `boardScores`),
 * never from a client packet.
 */
export const BOXITY_BOARDS = [
  { id: 'wins', label: 'Total Wins', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'playtime', label: 'Playtime (minutes)', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
  { id: 'rebirths', label: 'Rebirths', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
]

/** This profile's score on each board, as `[boardId, score]`. */
export function boardScores(profile) {
  return [
    ['wins', Math.floor(profile.stats.winsEarned || 0)],
    ['playtime', Math.floor((profile.stats.playtime || 0) / 60)],
    ['rebirths', profile.rebirths || 0],
  ]
}
