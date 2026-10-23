export type Migration = { id: number; name: string; sql: string };

/**
 * Ordered, append-only schema migrations. Each migration runs once and is
 * recorded in `schema_migrations`, so the database can be upgraded in place.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Sofia',
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT,
  password_hash TEXT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#0f766e',
  avatar TEXT NOT NULL DEFAULT '🙂',
  role TEXT NOT NULL CHECK (role IN ('parent','adult','teen','child','relative')),
  relationship TEXT,
  birthday TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Sofia',
  locale TEXT NOT NULL DEFAULT 'en',
  is_admin INTEGER NOT NULL DEFAULT 0,
  permission_overrides_json TEXT NOT NULL DEFAULT '{}',
  notification_prefs_json TEXT NOT NULL DEFAULT '{}',
  deactivated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_members_email ON members(household_id, lower(email)) WHERE email IS NOT NULL AND deactivated_at IS NULL;
CREATE INDEX idx_members_household ON members(household_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_member ON sessions(member_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES members(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('personal','shared')),
  owner_member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'custom',
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calendars_household ON calendars(household_id);

CREATE TABLE calendar_shares (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  access TEXT NOT NULL DEFAULT 'view' CHECK (access IN ('view','edit')),
  PRIMARY KEY (calendar_id, member_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES members(id),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('household','private')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','tentative','cancelled')),
  recurrence_rule TEXT,
  recurrence_exception_dates_json TEXT NOT NULL DEFAULT '[]',
  reminder_minutes_json TEXT NOT NULL DEFAULT '[]',
  travel_minutes INTEGER NOT NULL DEFAULT 0,
  preparation_minutes INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'local',
  external_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_household_range ON events(household_id, starts_at);
CREATE INDEX idx_events_calendar ON events(calendar_id);
CREATE UNIQUE INDEX idx_events_external_uid ON events(household_id, source, external_uid) WHERE external_uid IS NOT NULL;

CREATE TABLE event_participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  response TEXT NOT NULL DEFAULT 'invited' CHECK (response IN ('invited','accepted','declined','tentative','awaiting')),
  is_required INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, member_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  category TEXT NOT NULL DEFAULT 'general',
  assigned_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES members(id),
  recurrence_rule TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_household ON tasks(household_id, status, due_at);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','done','cancelled')),
  related_type TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reminders_due ON reminders(status, remind_at);

CREATE TABLE shopping_lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  store TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  brand TEXT,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  estimated_price REAL,
  assigned_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','bought','removed')),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_shopping_items_list ON shopping_items(list_id, status);

CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  merchant TEXT,
  tracking_number TEXT,
  carrier TEXT,
  tracking_url TEXT,
  expected_from TEXT,
  expected_to TEXT,
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','in_transit','out_for_delivery','delivered','collected','missed','returned')),
  recipient_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  collector_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  instructions TEXT,
  pickup_point TEXT,
  collection_code TEXT,
  deadline TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_packages_household ON packages(household_id, status);

CREATE TABLE package_updates (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing','missed')),
  contact_name TEXT NOT NULL,
  phone TEXT,
  reason TEXT,
  notes TEXT,
  callback_at TEXT,
  deadline TEXT,
  assigned_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','postponed','cancelled')),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_calls_household ON calls(household_id, status);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('household','private','restricted')),
  owner_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  sensitive INTEGER NOT NULL DEFAULT 0,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_household ON notes(household_id, category);

CREATE TABLE note_shares (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, member_id)
);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  instructions TEXT,
  tags TEXT,
  servings INTEGER NOT NULL DEFAULT 4,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE meal_plan (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  title TEXT NOT NULL,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_meal_plan_date ON meal_plan(household_id, date);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT,
  min_stock REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE school_days (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  early_dismissal INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (member_id, date)
);

CREATE TABLE pickups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('dropoff','pickup')),
  time TEXT NOT NULL,
  responsible_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned','assigned','confirmed','completed','cancelled')),
  confirmed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_pickups_date ON pickups(household_id, date);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  destination TEXT,
  starts_at TEXT,
  ends_at TEXT,
  notes TEXT,
  budget REAL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','confirmed','completed','cancelled')),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trip_rsvps (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  guest_name TEXT,
  response TEXT NOT NULL DEFAULT 'awaiting' CHECK (response IN ('invited','accepted','declined','tentative','awaiting')),
  responded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_trip_rsvps_trip ON trip_rsvps(trip_id);

CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('date','destination','activity')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closes_at TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT
);

CREATE TABLE poll_votes (
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, option_id, member_id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high')),
  dedupe_key TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (member_id, dedupe_key)
);
CREATE INDEX idx_notifications_member ON notifications(member_id, read_at);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'high',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by TEXT REFERENCES members(id),
  decided_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX idx_approvals_household ON approval_requests(household_id, status);

CREATE TABLE agent_conversations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_messages_conversation ON agent_messages(conversation_id, created_at);

CREATE TABLE tool_executions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  conversation_id TEXT REFERENCES agent_conversations(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('success','error','pending_approval','denied')),
  error TEXT,
  approval_id TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tool_executions_household ON tool_executions(household_id, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_household ON audit_log(household_id, created_at);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','configured','connected','error')),
  display_name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, kind)
);
`,
  },
  {
    id: 2,
    name: "password_resets_and_rate_limits",
    sql: `
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
`,
  },
  {
    id: 3,
    name: "household_holiday_country",
    sql: `ALTER TABLE households ADD COLUMN holiday_country TEXT NOT NULL DEFAULT 'BG';`,
  },
  {
    id: 4,
    name: "member_dashboard_preferences",
    sql: `ALTER TABLE members ADD COLUMN dashboard_prefs_json TEXT NOT NULL DEFAULT '{}';`,
  },
  {
    id: 5,
    name: "personal_ai_media_and_movies",
    sql: `
ALTER TABLE members ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE members ADD COLUMN ai_model TEXT;
ALTER TABLE members ADD COLUMN persona TEXT;
ALTER TABLE members ADD COLUMN interests_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN ai_preferences_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE members ADD COLUMN share_family_knowledge INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN movie_preferences_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE agent_messages ADD COLUMN provider TEXT;
ALTER TABLE agent_messages ADD COLUMN model TEXT;
ALTER TABLE agent_messages ADD COLUMN external_services_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tool_executions ADD COLUMN external_service INTEGER NOT NULL DEFAULT 0;

CREATE TABLE member_memories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'private' CHECK (scope IN ('private','family')),
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'explicit',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_memories_member ON member_memories(member_id, scope);
CREATE INDEX idx_memories_household ON member_memories(household_id, scope);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('upload','generated','edited')),
  library TEXT NOT NULL DEFAULT 'studio' CHECK (library IN ('studio','photos')),
  source_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  checksum TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  caption TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  taken_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_media_owner ON media_assets(owner_member_id, library, created_at);
CREATE INDEX idx_media_household ON media_assets(household_id, library, created_at);

CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','family','selected')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_albums_household ON albums(household_id, created_at);

CREATE TABLE album_assets (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (album_id, asset_id)
);

CREATE TABLE album_shares (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (album_id, member_id)
);

CREATE TABLE asset_shares (
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, member_id)
);

CREATE TABLE image_workflows (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'comfyui' CHECK (provider IN ('comfyui')),
  operation TEXT NOT NULL CHECK (operation IN ('text_to_image','image_to_image','inpaint','background_replace','remove_object','restore','upscale')),
  workflow_json TEXT NOT NULL,
  model_label TEXT,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_workflows_household ON image_workflows(household_id, operation, enabled);

CREATE TABLE image_jobs (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'comfyui',
  workflow_id TEXT REFERENCES image_workflows(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  source_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  result_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  external_job_id TEXT,
  queue_position INTEGER,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_image_jobs_queue ON image_jobs(status, created_at);
CREATE INDEX idx_image_jobs_member ON image_jobs(member_id, created_at);

CREATE TABLE asset_embeddings (
  asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE movie_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tmdb_id INTEGER,
  title TEXT NOT NULL,
  year INTEGER,
  poster_url TEXT,
  overview TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
  language TEXT,
  status TEXT NOT NULL DEFAULT 'watchlist' CHECK (status IN ('watchlist','watched')),
  favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('tmdb','manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_movie_member_tmdb ON movie_entries(member_id, tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE INDEX idx_movie_member ON movie_entries(member_id, status, created_at);

CREATE TABLE movie_cache (
  tmdb_id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`,
  },
];
