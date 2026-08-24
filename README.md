# Fly Masters — Counselor Portal

Staff-only workspace. Students use the separate student website.

This is not a public signup site. A counselor is a normal Fly Masters user whose role is set to `counselor` by an admin. After sign-in, this app opens `/counselor`.

## Run

```bash
npm install
npm run dev
```

## What counselors get

| Page | Purpose |
|------|---------|
| Dashboard | Assigned leads, hot leads, conversions, follow-ups, shift timer |
| My Leads | CRM: cold → warm → hot → converted, call notes, next follow-up |
| My Students | Converted students assigned to you |
| Shortlists | Propose universities and courses |
| Student Chat | Human 1-to-1 inbox (`private_messages`, realtime) |
| Documents | Review files from assigned students |
| Leave / Attendance / Salary | HR self-service |

Queries filter by `assigned_counselor_id = current user`. Auth and data come from the live Fly Masters Supabase project.
