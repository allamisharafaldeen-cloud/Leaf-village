-- The Leaf Village · database
-- docs: one row per synced document (settings, each workout day, each study day, each weigh-in, ...)
CREATE TABLE IF NOT EXISTS docs (
  path    TEXT PRIMARY KEY,
  data    TEXT NOT NULL,              -- the document, as JSON
  removed TEXT NOT NULL DEFAULT '[]', -- entries taken out with Undo, so no copy brings them back
  mtime   INTEGER NOT NULL DEFAULT 0, -- when it was last edited (latest edit wins for settings and the like)
  updated INTEGER NOT NULL,           -- when the server stored it
  seq     INTEGER NOT NULL,           -- change counter: devices ask for "everything after seq N"
  base    INTEGER NOT NULL DEFAULT 0  -- the seq this version replaced (guards against two writers at once)
);
CREATE INDEX IF NOT EXISTS docs_seq ON docs (seq);

-- meta: the change counter, the database id, the push keys, which lines were said last
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', '0');

-- push_subs: where to send notifications (one row per device that turned them on)
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  device   TEXT,
  created  INTEGER NOT NULL,
  updated  INTEGER NOT NULL,
  fails    INTEGER NOT NULL DEFAULT 0
);
