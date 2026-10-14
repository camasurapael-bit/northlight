-- Northlight Studio — Supabase schema
-- Run this ONCE in Supabase → SQL Editor → New query → Run.
--
-- Security model: Row Level Security is ON and there are NO policies, so the public
-- (anon / publishable) key cannot read or write these tables at all. Only the Vercel
-- functions in /api reach them, using the secret key stored in Vercel env variables.

create extension if not exists btree_gist;

create table if not exists public.bookings (
  id             text primary key,
  ref            text not null unique,
  service_id     text not null,
  provider_id    text not null,
  booking_date   date not null,                 -- studio local date (Asia/Manila)
  start_min      int  not null check (start_min >= 0 and start_min < 1440),
  end_min        int  not null,                 -- start + service minutes + turnaround buffer
  minutes        int  not null check (minutes > 0),
  price          int  not null default 0,
  customer_name  text not null,
  customer_email text not null,
  customer_phone text not null default '',
  customer_notes text not null default '',
  reminder       text not null default 'none',
  status         text not null default 'confirmed' check (status in ('confirmed','completed','cancelled')),
  tz_at_booking  text not null default 'Asia/Manila',
  revisions      int  not null default 0,
  history        jsonb not null default '[]'::jsonb,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint bookings_end_after_start check (end_min > start_min),
  -- the database itself refuses a double booking, even if two people click at the same instant
  constraint bookings_no_overlap exclude using gist (
    provider_id with =,
    booking_date with =,
    int4range(start_min, end_min) with &&
  ) where (status <> 'cancelled')
);

create index if not exists bookings_email_idx on public.bookings (customer_email);
create index if not exists bookings_date_idx  on public.bookings (booking_date);

create table if not exists public.waitlist (
  id           text primary key,
  service_id   text not null,
  provider_id  text not null,
  booking_date date not null,
  email        text not null,
  name         text not null default '',
  status       text not null default 'waiting',
  created_at   timestamptz not null default now()
);

alter table public.bookings enable row level security;
alter table public.waitlist enable row level security;

revoke all on table public.bookings from anon, authenticated;
revoke all on table public.waitlist from anon, authenticated;
