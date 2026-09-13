# Community Model — Schema v2 (approved 2026-09-13, ready to build)

> Supersedes v1 (which had a `topics` table and host/member role flags).
> Once built, this becomes migration `010_community_rebuild.sql` and
> `schema.md` is rewritten to match. The live DB is empty, so the rebuild
> is a clean drop-and-create — no data migration.

## What we're building a system for

Neighborhood gatherings held in public space off the sidewalk/street: weekly,
weather permitting, entirely community-driven. A host makes the coffee, people
bring what they like, everyone talks.

Operating principles:
- A **connected community is a safer community** — knowing each other makes it
  easier to ask each other for help.
- We **encourage people to imagine the community** around them rather than let
  it shape itself from neglect or malicious actors. Intentional, kind, open.
- Conversations should be **vocalized and kept** — when people say what they
  hope their community looks like, we write it down (transparently) and let
  it take shape on its own.

### Naming (UI never says "coffee corner")

Site · Gathering · Person · Conversation. "Host" and "member" are **not**
categories — a person's engagement is shown by what they actually do
(attend, host), recorded on the gatherings.

## The product loop (why the schema is shaped this way)

1. A **person** scans a **QR code** at a hangout → lands on a public intake
   page → shares name + phone/email → becomes a **person** with
   `notify = true` for that site.
2. Anyone (a lapsed regular, a new neighbor, someone from next month over)
   can **host a gathering wherever they are** — they tell the system the date
   and place, the system records the **site's geolocation** from that, and
   **notifies everyone interested**.
3. Afterward the host writes a short **debrief** — loose notes of the
   conversations, especially affirmative statements about the kind of
   community people want.

So this is as much **event-planning software** as it is a people database.
(Schema note: the QR intake and notification *delivery* are features that
build on these tables; a scannable-at-a-public-place QR also means the app
will eventually need a public HTTPS URL — a deployment step, not a schema one.)

## Tables (6 + users, down from the inherited 17)

### people
One row per real person — hosts, regulars, one-timers, all the same table.
Deduped by name/phone/email (QR intake re-scans must not create duplicates).

| column | type | notes |
|---|---|---|
| id | serial PK | |
| first_name | text NOT NULL | |
| last_name | text | nullable — first-name-only is common |
| email | text | unique where not null (QR dedup + notifications) |
| phone | text | unique where not null (SMS + QR dedup) |
| neighborhood | text | free text, optional |
| active | bool default true | |
| notes | text | |
| extra | jsonb default '{}' | escape valve |
| created_at | timestamptz default now() | |

*(Engagement level is derived — how often they appear in `gathering_person`,
whether as host or attendee — not stored as a role.)*

### sites
A public spot, **defined by its location, not an address** (these happen in
street space, not at a building; lat/lon first for a future map).

| column | type | notes |
|---|---|---|
| id | serial PK | |
| name | text NOT NULL | whatever the spot's actually called |
| lat | double precision | the geolocation |
| lon | double precision | |
| gather_day | smallint | 0=Sun…6, nullable — the weekly rhythm |
| gather_time | text | free text ("10:00"), nullable |
| active | bool default true | |
| notes | text | e.g. "under the big oak, corner of 5th & Cedar" |
| extra | jsonb default '{}' | |
| created_at | timestamptz default now() | |

### site_person
A person's relationship to a site — right now just their opt-in.

| column | type | notes |
|---|---|---|
| person_id | FK people PK-part | |
| site_id | FK sites PK-part | |
| notify | bool default true | wants to hear when gatherings happen here (QR intake sets this) |
| since | date | |
| notes | text | |

No `is_host`/role flags — hosting is a behavior, recorded per gathering.

### gatherings
One occurrence at a site. "Weather permitting" lives here.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| site_id | FK sites NOT NULL | |
| host_person_id | FK people, nullable | who's hosting (the person who told us they're hosting) |
| date | date NOT NULL | |
| status | text | `planned` / `held` / `cancelled` (default `planned`) |
| notes | text | what happened, loose |
| conversations | jsonb default '[]' | **the debrief** — an array of short notes of what people talked about / hoped for. Free-form strings, written by the host, gathered transparently. Example: `["Many people said they hope for less police and more outreach workers", …]` |
| extra | jsonb default '{}' | |
| created_at | timestamptz default now() | |

*(v1's separate `topics` table is gone: conversations stay a blob on the
gathering they happened in. If some of them later harden into real ongoing
efforts, promote those to a table then — don't pre-structure.)*

### gathering_person
Who was there.

| column | type | notes |
|---|---|---|
| gathering_id | FK gatherings PK-part | |
| person_id | FK people PK-part | |
| role | text default 'attendee' | `host` / `attendee` / `mentioned` |

### users
App logins for when auth is re-enabled. Kept as-is from the inherited schema.

### Dropped entirely (inherited CRM concepts)
`accounts`, `vendors`, `systems`, `components`, `components_used`,
`credentials`, `subscriptions`, `service_levels`, `person_account`,
`person_vendor`, `site_account`, `interactions`, `interaction_person`,
`person_site` — plus v1's `topics`.

## Build steps

1. `database/010_community_rebuild.sql` — drop the 14 retired tables, drop +
   recreate `people` and `sites` (new shapes), create `site_person`,
   `gatherings`, `gathering_person`. Keep `users`. Apply locally.
2. Rewrite `schema.md` to match.
3. Frontend repoint: pages/routes → **People, Sites, Gatherings** (Settings
   stub). Gathering page gets the `conversations` debrief editor (a simple
   "add a note" list) and the hosting/notify affordances.
4. `ARCHITECTURE.md` for the new reality.
5. Verify: `node --check`, restart, exercise create/read per entity via API.

## Later features (built on this schema, not part of the rebuild)

- **QR intake** — public, unauthenticated landing page per site (QR encodes the
  site) → person + site_person(notify). Requires a public HTTPS URL + care
  around the PII in intake.
- **Notification delivery** — email/SMS to `site_person.notify = true` when a
  gathering is scheduled (needs a provider).
- **Map** — lat/lon are ready; a map view when wanted.
- **Public exposure** — Tailscale Funnel / small VPS / Fly — decided when the
  QR flow is time to build, not now.
