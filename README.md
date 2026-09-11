# CCS Code Challenge

An offline, LAN-based programming competition platform for the **College of Computing and Sciences**. Players join with a username only, work through server-authoritative timed levels, and an admin dashboard shows a live-updating ranking — all on a local Wi-Fi/LAN network with no internet required to run.

---

## 1. Requirements

- [Node.js](https://nodejs.org/) v18 or newer, on the computer that will act as the **server** (the competition host machine).
- Players just need a web browser (Chrome, Edge, Firefox) on any device connected to the same Wi-Fi/LAN — no installation needed on their end.

> **Note on internet access:** `npm install` needs internet access **once**, to download the two dependencies (Express and better-sqlite3). After that, the competition itself runs 100% offline over your local network — no internet required on competition day.

---

## 2. Installation

```bash
npm install
```

## 3. Start the server

```bash
npm start
```

For development (auto-restarts on file changes):

```bash
npm run dev
```

You should see something like:

```
==============================================
  CCS CODE CHALLENGE - Competition Server
==============================================
  Local:    http://localhost:3000
  Network:  http://192.168.1.100:3000   <-- share this with players
  Admin:    http://localhost:3000/admin
==============================================
```

A SQLite database is created automatically at `database/competition.db` on first run, pre-loaded with 5 sample levels (Variables, Operators, Conditional Statements, Loops, Functions) so you can test immediately.

---

## 4. Connecting other computers (LAN setup)

1. On the **host computer**, find its local IPv4 address:

   - **Windows:** open Command Prompt and run `ipconfig`, look for "IPv4 Address" under your active Wi-Fi/Ethernet adapter.
   - **macOS/Linux:** run `ifconfig` or `ip addr`.

2. Make sure all player computers are connected to the **same Wi-Fi/LAN network** as the host.

3. On each player's browser, go to:

   ```
   http://HOST-IP:3000
   ```

   Example: `http://192.168.1.100:3000`

4. The admin controls the competition from:

   ```
   http://HOST-IP:3000/admin
   ```

   Default admin password: **`admin123`**
   You can change it by starting the server with an environment variable:

   ```bash
   ADMIN_PASSWORD=your-new-password npm start
   ```

### Windows Firewall

If other computers can't reach the server, Windows Firewall may be blocking incoming connections on port 3000:

1. Open **Windows Defender Firewall with Advanced Security**.
2. Click **Inbound Rules** → **New Rule...**
3. Choose **Port** → **TCP** → Specific local port: `3000` → **Allow the connection**.
4. Apply it to all profiles (or at least Private/Home networks) and give it a name like "CCS Code Challenge".

---

## 5. Running a competition

1. Start the server on the host machine (`npm start`).
2. Share the network URL with participants; they enter a username and land on their dashboard.
3. In `/admin`, log in and use the **Competition Control** panel:
   - **Start Competition** — players can now begin submitting answers.
   - **Pause Competition** — freezes progression; players see a "Competition Paused" screen.
   - **Resume** — players continue exactly where they left off (timers are server-side, so nothing is lost).
   - **End Competition** — locks further submissions; useful once time is up.
   - **Reset Competition** — wipes all player progress/attempts/times (asks for confirmation first). Levels and questions are **not** deleted.
4. Watch the **Live Ranking** tab update automatically as players complete levels — no refresh needed.
5. Use the **Players** tab to monitor who's active, what level they're on, and how long they've been on it.

---

## 6. Managing levels and questions

From `/admin` → **Levels & Questions**:

- **Add Level** — set a level number, title, and description. Levels display to players in `sort_order`.
- **Edit / Delete Level** — delete asks for confirmation; deleting a level also removes its questions and any related player progress for it.
- Click a level to manage its **Questions**. Each question has a title, programming language, description, code block, correct answer, and an optional "case sensitive" toggle.
- Answer checking always trims and collapses whitespace (`"30"` and `" 30 "` are equivalent) and is case-insensitive unless you enable case sensitivity for that question.

There's no hard-coded limit on the number of levels — add as many as you like (5, 10, 20, 50+) and the player dashboard will display them all automatically.

---

## 7. How timing & level-locking work (server-authoritative)

- The server, not the browser, records `started_at` / `completed_at` / `elapsed_seconds` for every level attempt.
- A level's timer starts the moment it's first opened by the player and keeps running through wrong attempts — only a correct answer stops it.
- If a player refreshes their browser mid-level, the timer picks up from the correct elapsed time (computed from the server's `started_at`), not from zero.
- The backend independently verifies level access on every request — modifying the browser URL or JavaScript cannot unlock a level early or change recorded times.
- Ranking is computed entirely server-side using: (1) levels completed, descending, (2) total completion time, ascending, (3) final completion timestamp, ascending — as a deterministic tie-breaker.

---

## 8. Project structure

```
ccs-code-challenge/
│
├── server/
│   ├── index.js               # Express app entry point, LAN server bootstrap
│   ├── config.js              # Port / admin password / DB path config
│   ├── database.js            # SQLite connection, schema, sample data seed
│   ├── routes/
│   │   ├── players.js         # Registration, dashboard, level start/submit
│   │   ├── levels.js          # Public level listing
│   │   ├── leaderboard.js     # Leaderboard snapshot + SSE live stream
│   │   └── admin.js           # Admin auth, CRUD, competition controls, stats
│   └── services/
│       ├── competitionService.js  # Core domain logic (levels, ranking, stats)
│       ├── answerCheck.js         # Whitespace/case-insensitive answer matching
│       └── sse.js                 # Server-Sent Events pub/sub
│
├── database/
│   └── competition.db         # Created automatically on first run
│
├── public/
│   ├── index.html             # Username entry / competition landing page
│   ├── player.html            # Player dashboard (levels, timer, question, answer)
│   ├── admin.html             # Admin dashboard (control, levels, players, ranking)
│   ├── css/
│   │   ├── main.css           # Shared design tokens / terminal aesthetic
│   │   ├── player.css
│   │   └── admin.css
│   └── js/
│       ├── player.js
│       └── admin.js
│
├── package.json
└── README.md
```

---

## 9. Database schema

SQLite tables: `competition`, `players`, `levels`, `questions`, `player_levels`, `attempts`. Foreign keys and indexes are enabled; see `server/database.js` for the full `CREATE TABLE` statements.

---

## 10. Resetting for another competition

Use **Reset Competition** in the admin panel between runs — it clears players, attempts, and progress while keeping your levels/questions intact so you don't have to re-enter them. If you want a completely fresh database instead, stop the server and delete the `database/competition.db*` files; a new one (with the sample levels) will be created on next start.
