---
game: 1-slide-downhill
displayName: +1 Slide Downhill
canDie: false
hasScore: true
leaderboards: [wins, playtime, rebirths]
multiplayer: hosted
roomSize: 8
---

# Boxity integration

Answers the code can't give, as the developer gave them, and where each Boxity feature
lives.

- **canDie: false.** The player walks, trains and slides; nothing kills them, so there
  is no death screen. Boxity's menu "Reset Character" (`respawn_request`) puts you back
  at spawn.
- **hasScore: true**, three boards, declared in `shared/bloxityBoards.js`:
  `wins` (Total Wins, compact), `playtime` (minutes), `rebirths`. All "best", highest
  wins, All Time. Scores are reported by the game server from the saves it owns
  (`server/src/bloxity.js`, `BLOXITY_REPORT_TOKEN`), never from the browser.

| Feature | Where |
|---|---|
| Environment (prod / stage / local) | `client/src/bloxity/env.js`, `server/src/bloxity.js`, dev injection in `client/vite.config.js` |
| Init, auth, avatar subscriptions | `client/src/bloxity/BloxityProvider.jsx` (one `onUserChanged`) |
| Leaderboards, emotes, ad breaks, settings, player events, chat | `client/src/bloxity/features.js` |
| Rooms, friend toasts, screen ads, gameplay start | `client/src/bloxity/platform.js` |
| Matchmaker, `?roomId=`, rejoin on sign-in | `client/src/net/connection.js` |
| Session verification, guest progress carry-over | `server/src/rooms/GameRoom.js` (`onAuth`), `server/src/db.js` |
| Gems webhook (no Gems products yet) | `server/src/server.js` (`POST /api/bloxity/gems`) |
| Deploy to prod + stage | `.github/workflows/deploy.yml` |
