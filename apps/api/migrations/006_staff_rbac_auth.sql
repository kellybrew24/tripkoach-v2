-- TRI-860 Phase 1 · Staff / RBAC / auth (admin). Tables SCAFFOLDED now; write/login paths land in Phase 3.

CREATE TABLE staff_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text,                 -- argon2id
  name            text,
  phone           text,
  job_title       text,
  role            text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','operator','viewer')),
  status          text NOT NULL DEFAULT 'invited' CHECK (status IN ('active','invited','disabled')),
  mfa_enabled     boolean NOT NULL DEFAULT false,
  last_active_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Editable role × permission matrix. admin = all-locked-on (enforced in app).
CREATE TABLE role_permission (
  role        text NOT NULL CHECK (role IN ('admin','operator','viewer')),
  permission  text NOT NULL CHECK (permission IN
                ('tours.view','tours.edit','bookings.view','bookings.manage','bookings.cancel',
                 'payments.refund','customers.view','promos.manage','users.manage','settings.manage')),
  allowed     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, permission)
);

CREATE TABLE mfa_factor (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id  uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  type           text NOT NULL DEFAULT 'totp' CHECK (type IN ('totp')),
  secret         text NOT NULL,          -- encrypted at rest (Phase 3)
  added_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recovery_code (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id  uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  code_hash      text NOT NULL,
  used_at        timestamptz
);

-- Server-side sessions back revocation + admin session-management/expiry screens.
CREATE TABLE session (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   text NOT NULL CHECK (subject_type IN ('user','staff')),
  subject_id     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  trusted_device boolean NOT NULL DEFAULT false,
  ip             text,
  user_agent     text,
  revoked_at     timestamptz
);
CREATE INDEX session_subject_idx ON session(subject_type, subject_id);

CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type   text NOT NULL,
  actor_id     uuid,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  before       jsonb,
  after        jsonb,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target_idx ON audit_log(target_type, target_id);
