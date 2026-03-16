PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_taxonomy (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT,
  level INTEGER DEFAULT 0,
  parent_id TEXT,
  sort_order INTEGER DEFAULT 0,
  sop_status TEXT,
  sop_draft_url TEXT,
  sop_final_url TEXT,
  sop_final_pdf_url TEXT,
  sop_generated_at TEXT,
  sop_finalized_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_flows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  process_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  flow_data TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  flow_data TEXT NOT NULL,
  sop_url TEXT,
  version_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
