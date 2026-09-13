# Community Model — Proposed Schema (PLAN, not yet built)

> Status: **proposed, pending review.** Once approved, this becomes migration
> `010_community_rebuild.sql` and supersedes the ClowdForce-era schema in
> `schema.md`. The live DB is empty, so the rebuild is a clean drop-and-create —
> no data migration needed.

## What we're building a system for

Neighborhood gatherings held in public space off the sidewalk/street: weekly,
weather permitting, entirely community-driven. A host makes the coffee, people
bring what they like, everyone talks. The operating principles:

- A **connected community is a safer community** — knowing each other makes it
  easier to ask each other for help.
- We **encourage people to imagine the community** around them rather than let
  it shape itself from neglect or malicious actors. Intentional, kind, open.
- Things may **emerge organically** from these conversations; we record them
  lightly and let them find their own shape.

### Naming

The UI does **not** use the phrase "coffee corner." Neutral terms:

| Concept | Term used |
|---|---|
| A place where gatherings happen | **Site** |
| One occurrence (weekly, weather permitting) | **Gathering** |
| The person/people who host | **Host** |
| Anyone in the community | **Member** (person) |
| An idea or topic raised at a gathering | **Topic** |

## Proposed tables (7, down from 17)

### people  *(rebuild of inherited table)*
A community member. One row per real person, deduped by name/phone/email.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| first_name | text NOT NULL | |
| last_name | text | nullable — first-name-only is common and fine |
| email | text | for notifications |
| phone | text | for notifications |
| neighborhood | text | free text, optional — which part of the area they're in |
| active | bool default true | |
| notes | text | |
| extra | jsonb default '{}' | escape valve |
| created_at | timestamptz default now() | |

*(Dropped from the inherited version: personal_address, external_link, next_contact_date, client_since, VIP flags — CRM concepts.)*

### sites  *(rebuild of inherited table)*
A public spot where gatherings happen.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| name | text NOT NULL | e.g. a recognizable place name |
| address_line1 / city / state / zip | text | the public-space location |
| gather_day | smallint | 0=Sun…6=Sat, nullable — the weekly rhythm |
| gather_time | text | free text ("10:00"), nullable |
| active | bool default true | |
| notes | text | |
| extra | jsonb default '{}' | e.g. lat/lon for a future map, "under the big oak" |
| created_at | timestamptz default now() | |

*(Dropped: site_type taxonomy, former_homeowner, system_info — building-security concepts.)*

### site_person  *(rebuild; replaces inherited person_site)*
The person↔site relationship — this is where **hosting** and
**notification preference** live.

| column | type | notes |
|---|---|---|
| person_id | FK people PK-part | |
| site_id | FK sites PK-part | |
| is_host | bool default false | a facilitator at this site (hosts it, or wants to host it — use notes/role_label for "wants to") |
| notify | bool default true | wants to hear when gatherings happen here |
| role_label | text | free text, e.g. "co-host", "brings pastries" |
| notes | text | |
| since | date | when they joined in |

A person with `is_host` at one or more sites **is** the facilitator.
An attendee who "wants to be notified" is a row with `notify = true`.
No separate facilitator/attendee tables needed — roles are per-site.

### gatherings  *(new; replaces inherited interactions)*
One occurrence at a site. "Weather permitting" lives here: a weekly site
generates planned gatherings, each marked held or cancelled.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| site_id | FK sites NOT NULL | |
| date | date NOT NULL | |
| status | text | `planned` / `held` / `cancelled` (default `planned`) |
| notes | text | what happened, loose |
| extra | jsonb default '{}' | |
| created_at | timestamptz default now() | |

### gathering_person  *(new; replaces inherited interaction_person)*
Who was there.

| column | type | notes |
|---|---|---|
| gathering_id | FK gatherings PK-part | |
| person_id | FK people PK-part | |
| role | text default 'attendee' | `host` / `attendee` / `mentioned` |

### topics  *(new)*
Ideas and threads raised at gatherings. Deliberately light — no forced
workflow; status is a suggestion, not a funnel.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| summary | text NOT NULL | the idea, in a sentence or two |
| status | text default 'open' | `open` / `in_motion` / `done` / `shelved` |
| site_id | FK sites, nullable | which site it belongs to, or general |
| raised_at_gathering_id | FK gatherings, nullable | where it came up |
| raised_by_person_id | FK people, nullable | |
| notes | text | |
| extra | jsonb default '{}' | |
| created_at | timestamptz default now() | |

### users  *(kept as-is)*
App logins for when auth is re-enabled. Unchanged from the inherited table.

### Dropped entirely
`accounts`, `vendors`, `systems`, `components`, `components_used`,
`credentials`, `subscriptions`, `service_levels`, `person_account`,
`person_vendor`, `site_account`, `interactions`, `interaction_person`,
`person_site` — all CRM concepts with no community-organizing role.

## What this gives us (and leaves out, on purpose)

**Gives:** the four requested things (sites, hosts/facilitators,
notifiable attendees, topics) plus attendance, which the principles imply —
seeing who shows up repeatedly *is* the connectedness made visible, and it's
what "easier to ask each other for help" runs on.

**Intentionally out of scope for now:**
- Notification *delivery* (SMS/email) — `site_person.notify` is the data; the channel is a later feature.
- Maps/lat-lng — possible via `extra` until needed.
- Groups/sub-communities — let them emerge as real topics first, then model them.
- Signups/RSVPs — one flag on gathering_person later if wanted.

## Build steps (after approval)

1. `database/010_community_rebuild.sql` — drop the 14 retired tables, drop + recreate `people`, `sites`; create `site_person`, `gatherings`, `gathering_person`, `topics`. Keep `users`. Apply to the local DB.
2. Rewrite `schema.md` to match (it's the canonical reference — must not drift).
3. Frontend: the SPA's pages/route list are hardwired to the old entities (Accounts, People, Sites, Vendors, Systems…) — repoint to the new five: **People, Sites, Gatherings, Topics** (+ a Settings/auth stub). This is the bigger half of the work and follows the schema.
4. `ARCHITECTURE.md`: fill in for the new reality.
5. Re-verify: `node --check`, restart service, exercise a create/read per entity through the API.

## Open questions for Will

1. **Terms** — "Site / Gathering / Host / Member / Topic": good, or do any feel wrong for how the community actually talks?
2. **Site address** — full street address is fine to store (it's a public spot), right? Or is there any spot that isn't fully public?
3. **One site per week vs. many** — is it one neighborhood site, or will there be several sites with their own weekly rhythms? (Schema handles both; it changes the UI emphasis.)
4. **Topics** — is the light `open / in_motion / done / shelved` the right amount of structure, or do you want them to stay even looser (no status at all until something actually takes shape)?
