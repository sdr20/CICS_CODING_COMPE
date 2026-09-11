/**
 * database.js
 * ------------------------------------------------------------------
 * Single source of truth for the SQLite connection, schema creation,
 * and initial sample-data seeding. Every other module gets the
 * shared `db` handle from here instead of opening its own connection.
 * ------------------------------------------------------------------
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./config');

// Make sure the /database folder exists (fresh clone won't have it committed empty).
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS competition (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      name               TEXT NOT NULL DEFAULT 'CCS Code Challenge',
      status             TEXT NOT NULL DEFAULT 'NOT_STARTED'
                           CHECK (status IN ('NOT_STARTED','RUNNING','PAUSED','ENDED')),
      started_at         TEXT,
      paused_at          TEXT,
      ended_at           TEXT
    );

    CREATE TABLE IF NOT EXISTS players (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      username                  TEXT NOT NULL UNIQUE,
      created_at                TEXT NOT NULL DEFAULT (datetime('now')),
      status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                                  CHECK (status IN ('ACTIVE','COMPLETED','DISCONNECTED')),
      competition_started_at    TEXT,
      competition_completed_at  TEXT,
      total_time_seconds        INTEGER
    );

    CREATE TABLE IF NOT EXISTS levels (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      level_number  INTEGER NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      description   TEXT,
      sort_order    INTEGER NOT NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id        INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT,
      code            TEXT,
      language        TEXT DEFAULT 'C++',
      correct_answer  TEXT NOT NULL,
      case_sensitive  INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS player_levels (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      level_id       INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      started_at     TEXT,
      completed_at   TEXT,
      elapsed_seconds INTEGER,
      status         TEXT NOT NULL DEFAULT 'LOCKED'
                       CHECK (status IN ('LOCKED','AVAILABLE','IN_PROGRESS','COMPLETED')),
      UNIQUE(player_id, level_id)
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id         INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      level_id          INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      question_id       INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      submitted_answer  TEXT,
      is_correct        INTEGER NOT NULL,
      attempted_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_player_levels_player ON player_levels(player_id);
    CREATE INDEX IF NOT EXISTS idx_player_levels_level ON player_levels(level_id);
    CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_player ON attempts(player_id);
    CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
  `);

  // Ensure the single competition row (id = 1) always exists.
  const row = db.prepare('SELECT id FROM competition WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO competition (id, name, status) VALUES (1, 'CCS Code Challenge', 'NOT_STARTED')`
    ).run();
  }
}

function seedSampleData() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM levels').get().c;
  if (count > 0) return; // Already seeded, don't duplicate on restart.

  const insertLevel = db.prepare(
    `INSERT INTO levels (level_number, title, description, sort_order, is_active)
     VALUES (?, ?, ?, ?, 1)`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO questions (level_id, title, description, code, language, correct_answer, case_sensitive)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  );

  const sample = [
    {
      number: 1,
      title: 'Variables',
      description: 'Basic variables and data types',
      question: {
        title: 'Basic Addition',
        description: 'What is the output of this program?',
        code:
`#include <iostream>
using namespace std;

int main() {
    int x = 5;
    int y = 10;

    cout << x + y;

    return 0;
}`,
        answer: '15'
      }
    },
    {
      number: 2,
      title: 'Operators',
      description: 'Arithmetic, relational and logical operators',
      question: {
        title: 'Modulo Operator',
        description: 'What is the output of this program?',
        code:
`#include <iostream>
using namespace std;

int main() {
    int a = 17;
    int b = 5;

    cout << a % b;

    return 0;
}`,
        answer: '2'
      }
    },
    {
      number: 3,
      title: 'Conditional Statements',
      description: 'if / else and branching logic',
      question: {
        title: 'Simple Branch',
        description: 'What is the output of this program?',
        code:
`#include <iostream>
using namespace std;

int main() {
    int score = 82;

    if (score >= 90) {
        cout << "A";
    } else if (score >= 80) {
        cout << "B";
    } else {
        cout << "C";
    }

    return 0;
}`,
        answer: 'B'
      }
    },
    {
      number: 4,
      title: 'Loops',
      description: 'for and while loops',
      question: {
        title: 'Sum With A Loop',
        description: 'What is the output of this program?',
        code:
`#include <iostream>
using namespace std;

int main() {
    int sum = 0;

    for (int i = 1; i <= 5; i++) {
        sum += i;
    }

    cout << sum;

    return 0;
}`,
        answer: '15'
      }
    },
    {
      number: 5,
      title: 'Functions',
      description: 'Defining and calling functions',
      question: {
        title: 'Return Value',
        description: 'What is the output of this program?',
        code:
`#include <iostream>
using namespace std;

int square(int n) {
    return n * n;
}

int main() {
    cout << square(6);
    return 0;
}`,
        answer: '36'
      }
    }
  ];

  const insertAll = db.transaction((levels) => {
    levels.forEach((lvl, idx) => {
      const info = insertLevel.run(lvl.number, lvl.title, lvl.description, idx + 1);
      const levelId = info.lastInsertRowid;
      insertQuestion.run(
        levelId,
        lvl.question.title,
        lvl.question.description,
        lvl.question.code,
        'C++',
        lvl.question.answer
      );
    });
  });

  insertAll(sample);
}

createSchema();
seedSampleData();

module.exports = db;
