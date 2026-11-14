CREATE TABLE IF NOT EXISTS config (
  id integer PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  tg_id bigint PRIMARY KEY,
  name text NOT NULL DEFAULT 'Miner',
  balance double precision NOT NULL DEFAULT 0,
  total_mined double precision NOT NULL DEFAULT 0,
  miners jsonb NOT NULL DEFAULT '{}',
  last_collect timestamptz NOT NULL DEFAULT now(),
  banned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_claims (
  tg_id bigint NOT NULL,
  task_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tg_id, task_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id bigint PRIMARY KEY,
  tg_id bigint NOT NULL,
  amount double precision NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS withdrawals_tg_idx ON withdrawals (tg_id, created_at);