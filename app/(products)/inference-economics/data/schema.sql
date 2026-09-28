-- Inference Economics — the product's tables.
-- Generated from data/schema.ts by `pnpm game:embed`; edit that file, not this one.

CREATE TABLE IF NOT EXISTS ie_hardware (
  key TEXT PRIMARY KEY,
  name TEXT,
  from_year INTEGER,
  bw REAL,
  f16 REAL,
  f8 REAL,
  f4 REAL,
  spec TEXT,
  unit TEXT,
  stacks INTEGER,
  cap REAL,
  kw REAL,
  px REAL,
  nvlink INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS ie_years (
  year INTEGER PRIMARY KEY,
  era TEXT,
  tag TEXT,
  params REAL,
  kv_kb REAL,
  ctx INTEGER,
  demand REAL,
  max_b INTEGER,
  price REAL,
  brief TEXT,
  rec TEXT,
  evt TEXT
);

CREATE TABLE IF NOT EXISTS ie_tech (
  key TEXT PRIMARY KEY,
  name TEXT,
  cost INTEGER,
  from_year INTEGER,
  req TEXT,
  trap INTEGER,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_power (
  key TEXT PRIMARY KEY,
  name TEXT,
  mw REAL,
  px REAL,
  lead_years INTEGER,
  ferc INTEGER,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_train_cards (
  key TEXT PRIMARY KEY,
  name TEXT,
  from_year INTEGER,
  to_year INTEGER,
  f16 REAL,
  f8 REAL,
  bw REAL,
  cap REAL,
  kw REAL,
  px REAL,
  rent REAL,
  nvl_domain INTEGER,
  nvl_bw INTEGER,
  ban TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS ie_fabrics (
  key TEXT PRIMARY KEY,
  name TEXT,
  bw INTEGER,
  px REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS ie_archs (
  key TEXT PRIMARY KEY,
  name TEXT,
  act REAL,
  mfu REAL,
  req TEXT,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_attentions (
  key TEXT PRIMARY KEY,
  name TEXT,
  kv REAL,
  req TEXT,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_recomputes (
  key TEXT PRIMARY KEY,
  name TEXT,
  tax REAL,
  act REAL,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_data_tiers (
  key TEXT PRIMARY KEY,
  name TEXT,
  q REAL,
  px REAL,
  eng INTEGER,
  req TEXT,
  risk REAL,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_research (
  key TEXT PRIMARY KEY,
  name TEXT,
  cost INTEGER,
  from_year INTEGER,
  req TEXT,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS ie_pretrain_years (
  year INTEGER PRIMARY KEY,
  tag TEXT,
  hq_name TEXT,
  data_cap REAL,
  market REAL,
  fron_l REAL,
  fron_ref TEXT,
  comp REAL,
  ref_price REAL,
  seed REAL,
  brief TEXT,
  rec TEXT,
  evt TEXT
);

CREATE TABLE IF NOT EXISTS ie_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ie_terms (
  line TEXT NOT NULL,
  term TEXT NOT NULL,
  tip TEXT NOT NULL,
  PRIMARY KEY (line, term)
);

CREATE TABLE IF NOT EXISTS ie_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ie_saves (
  account TEXT NOT NULL,
  line TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account, line)
);

CREATE TABLE IF NOT EXISTS ie_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  display TEXT NOT NULL,
  line TEXT NOT NULL,
  rank TEXT NOT NULL,
  score REAL NOT NULL,
  summary TEXT NOT NULL,
  finished_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ie_runs_line_score ON ie_runs (line, score DESC);
