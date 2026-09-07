# VITRIOL — STORY MODE

The build plan. This document is the spine of a multi-session piece of work:
it exists so any session can pick the work up cold, see what is done, and know
what the next thing is. **Keep the phase checklist at the bottom current.**

---

## What story mode is

Campaign mode is a difficulty curve with a loadout that carries. Story mode is
a **generated world with a story running through it**. Every run invents its
own factions, people, places, artifact and twist, and lays a dramatic spine
over a sequence of missions. Two runs of story mode should feel like two
different games, not two seeds of the same one.

The three things that make it work:

1. **The world is generated before the story is.** Factions, characters and
   places exist first, with relationships between them. The story is then
   built *out of* what the world contains — which is why the beats always
   connect to something, and why a betrayal is by someone you have met.
2. **Level styles are locations.** The 21 architectures stop being a texture
   choice and become named places with an owner and a history. `THE ASH FORGE`
   is an `industrial` level, held by a faction, and the mission you play there
   is about what that faction did in it.
3. **Nothing is written down that could be generated.** Names, doctrines,
   histories, dialogue registers and beats all come out of grammars seeded by
   the run. Written prose is reserved for the pieces that have to be exactly
   right — the structural twists, the objective verbs.

---

## Architecture

```
src/game/lore.js       the world: factions, characters, places, artifact, secret
src/game/story.js      the run: acts, beats, missions, choices, reputation
src/game/cutscene.js   staged pixel cutscenes between beats
src/game/story-ui.js   the story screens: briefing, choice, codex, dossier
```

`lore.js` knows nothing about missions. `story.js` knows nothing about
rendering. `cutscene.js` knows nothing about how a beat was chosen. That
separation is what lets each be tested on its own and rewritten without the
others noticing.

### lore.js — the world

Seeded. `makeWorld(seed, opts)` returns a frozen description of a place:

- **Factions** (4–6, drawn from a larger pool of doctrines so the mix differs).
  Name, doctrine, colours, leader, holdings, a relation matrix, a secret.
  A doctrine is mechanical as well as fictional: it modifies the stats of the
  units that faction fields and which level kinds they hold.
- **Characters**. `you`, `handler`, `rival`, `oracle`, `antagonist`, plus
  faction leaders. Name, faction, rig params (so they have a face), a voice
  register that shapes how their lines are phrased, and a standing with you
  that moves during the run.
- **Places**. One per location in the run: a named level style with an owner,
  a one-line history, and a role in the story.
- **The artifact**. What everyone wants, and what it turns out to be.
- **The secret**. The act-three turn. Structural, not decorative — it changes
  who the last mission is against.

### story.js — the run

`makeStory(world, opts)` lays a three-act spine over the world and returns a
list of **beats**. A beat is either a MISSION or an INTERLUDE.

Missions carry an **objective** — the reason you are there, which the mission
layer enforces:

| objective  | what it is |
|---|---|
| `extract`  | reach the pad. The baseline. |
| `hunt`     | a named target is in here. Kill it. |
| `purge`    | kill everything. |
| `sabotage` | destroy N marked structures. |
| `recover`  | find the cache, carry it out. |
| `survive`  | hold for T seconds, then the pad opens. |
| `escort`   | an ally has to reach the pad alive. |

Interludes are **choices**: two or three options that set flags, move faction
reputation, and change what comes after. A story is not a branching tree — it
is a spine with a memory. The beats are fixed in shape; what varies is who
they are against, what they cost you, and how they end.

### cutscene.js — the staged scenes

Between beats. A cutscene is a list of **shots**; a shot is a backdrop, up to
three staged characters, a camera move, and a line. The **director** turns a
beat into shots: it knows who is present and what happened, and picks a
staging template. Everything is drawn from things the game already bakes —
location backdrops, MERC FORGE rigs for faces — so a cutscene costs no assets.

---

## Phases

Each phase ends with the harness green and a commit. A phase is not done until
its checks exist.

- [x] **1 — The world.** `lore.js`: factions, doctrines, characters, places,
      artifact, secret, relations. Harness coverage: determinism, variety,
      internal consistency (every holding has an owner, every character a
      faction that exists, no faction at war with itself).
- [x] **2 — The run.** `story.js`: acts, beats, objectives, choices,
      reputation, character traits. Mission layer enforces objectives.
- [ ] **3 — Cutscenes.** `cutscene.js` + director + renderer.
- [ ] **4 — Nature.** Vegetation and natural level kinds in GREEBLEWORKS:
      `overgrowth`, `fungal`, `mire`, `frost`. A `bakeFlora` pass.
- [ ] **5 — New enemies.** Faction unit archetypes with doctrine modifiers.
- [ ] **6 — New weapons and dynamics.** Faction arsenals; reputation effects.
- [ ] **7 — UI.** Story setup, briefing screen, choice screen, codex, dossier.
- [ ] **8 — Integration.** Autopilot plays story mode; README; polish pass.

---

## Rules for this build

- Every phase leaves the game playable and the harness green.
- Autopilot must be able to play everything. It is the regression test that
  catches level-design mistakes no assertion can.
- Generated text goes through grammars with enough parts that 200 rolls do not
  repeat. The harness checks that.
- No new asset files. Everything is baked from the generators that exist.
