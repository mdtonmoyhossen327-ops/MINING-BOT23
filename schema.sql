CREATE TABLE app.config (
  id integer PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE app.players (
  tg_id bigint PRIMARY KEY,
  name text NOT NULL,
  balance jsonb NOT NULL,
  total_mined jsonb NOT NULL,
  miners jsonb NOT NULL,
  last_collect timestamptz NOT NULL,
  banned boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE app.task_claims (
  tg_id bigint NOT NULL,
  task_id text NOT NULL,
  claimed_at timestamptz NOT NULL,
  PRIMARY KEY (tg_id, task_id)
);

CREATE TABLE app.withdrawals (
  id bigint PRIMARY KEY,
  tg_id bigint NOT NULL,
  amount jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX withdrawals_tg_idx ON app.withdrawals (tg_id, created_at);