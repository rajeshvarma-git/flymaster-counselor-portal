CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS counselor_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  bio TEXT,
  specializations TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email TEXT NOT NULL,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  preferred_countries TEXT[],
  field_of_interest TEXT,
  academic_score TEXT,
  lead_status TEXT DEFAULT 'warm',
  lead_stage TEXT,
  lead_source TEXT,
  priority TEXT,
  entity_type TEXT DEFAULT 'lead',
  status TEXT NOT NULL DEFAULT 'assigned',
  assigned_counselor_id UUID,
  notes TEXT,
  next_follow_up_date TIMESTAMPTZ,
  last_contact_date TIMESTAMPTZ,
  conversion_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counselor_id UUID NOT NULL,
  student_id UUID NOT NULL,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT,
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  document_type TEXT,
  file_name TEXT,
  status TEXT DEFAULT 'uploaded',
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS university_shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID,
  counselor_id UUID,
  university_name TEXT,
  course_name TEXT,
  location TEXT,
  counselor_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counselor_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counselor_id UUID NOT NULL,
  leave_type TEXT,
  start_date DATE,
  end_date DATE,
  reason TEXT,
  total_days INTEGER,
  status TEXT DEFAULT 'pending',
  applied_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counselor_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counselor_id UUID NOT NULL,
  date DATE NOT NULL,
  clock_in TIME,
  clock_out TIME,
  total_hours NUMERIC,
  status TEXT DEFAULT 'present'
);

CREATE TABLE IF NOT EXISTS counselor_salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counselor_id UUID NOT NULL,
  month TEXT,
  year INTEGER,
  net_salary NUMERIC,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS app_records (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_records_table ON app_records(table_name);
