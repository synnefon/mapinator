# Fun-fact combo audit

City "fun facts" (the footer line under a city in the info popup) are assembled combinatorially from slot
pools in `src/mapgen/features/funFact.ts`. Combinatorial assembly can produce nonsensical lines
(*"its orchards have stood for generations on market days"*). This doc explains how to **enumerate every
reachable combo, eyeball them, and fix the nonsense** using the engine's declarative levers.

This is an audit you run with **your own judgment** — the script only *produces* the combinations; deciding
what reads as nonsense is the human/agent part.

---

## 1. How a fun fact is built (mental model)

`generateFunFact(ctx)` tries every entry in `FUN_FACT_PATTERNS`, keeps the ones whose conditions fire for
that city, and picks one (preferring lines the country hasn't used yet).

Patterns are either **slot templates** or **slotless one-liners**:

- `"{subject} {predicate}"` and `"{subject} {predicate} {qualifier}"` — the combinatorial ones, drawn from
  the `subject` / `predicate` / `qualifier` pools. **This is where ~all nonsense lives.**
- single-slot pools: `reputation`, `landscape`, `origin`, `dish`, `nickname`, `placeMemory`, `localHabit`,
  `weirdDetail` — each rendered into a fixed frame (e.g. `"known across {country} as {reputation}"`).
- slotless one-liners (climate/terrain/government flavor) — fixed strings gated by `when`.

A `FactPart` is `{ text, when?, number?, fit?, accepts?, kind?, attachTo?, cityWide? }`. Verb agreement is
automatic: the chosen **subject**'s `number` expands `{cop}`→is/are, `{have}`→has/have, `{v:base}`→draws/draw
via `inflect`, so predicates are written once.

Two grammatical-fit axes prune semantic mismatches, both **default-open** so a bare entry stays maximally
reachable:

- **predicate ↔ qualifier** (`accepts` on predicates, `fit` on qualifiers): which trailing clause categories
  read after a predicate.
- **predicate ↔ subject** (`attachTo` on predicates, `kind` on subjects): which *kind* of feature a predicate
  attaches to. A subject's `kind` is one of `market` / `industry` / `place` / `institution` / `landmark` /
  `rampart`; a predicate's `attachTo` lists the kinds it fits (omit ⇒ all kinds). This stops a commerce/bustle/
  records predicate from landing on the wrong feature (*"its bell tower anchors the local economy"*, *"its
  foundries draw crowds"*). cityWide subjects bypass it.

---

## 2. Generate the dump

There is no standalone script runner in this repo (only `vitest`). Dump via a **throwaway test** — write the
report straight to a file with `node:fs`. (`@types/node` isn't installed, so this wouldn't *typecheck* as a
committed file, but esbuild strips the types at runtime and Node provides `fs`, so the throwaway runs fine. Do
**not** `console.log` the report instead: vitest truncates a single multi-thousand-line log, silently dropping
the grouped views at the end — the highest-signal part.)

```bash
# 1. create a throwaway dump test
cat > src/mapgen/features/_dump.test.ts <<'EOF'
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { formatAuditReport } from "./funFactAudit";
describe("dump", () => {
  it("writes the audit report to a file", () => writeFileSync("/tmp/funfacts.txt", formatAuditReport()));
});
EOF

# 2. run it (writes /tmp/funfacts.txt)
npx vitest run src/mapgen/features/_dump.test.ts >/dev/null 2>&1

# 3. remove the throwaway
rm src/mapgen/features/_dump.test.ts
```

`/tmp/funfacts.txt` now contains:

- `reachable facts: <N>` — the total distinct reachable facts.
- `=== ALL FACTS (sorted) ===` — every reachable fun fact, one per line.
- `=== SUBJECT per PREDICATE ===` — for each predicate, the subjects it can follow.
- `=== QUALIFIER per PREDICATE ===` — for each predicate, the qualifiers that can trail it.

The pool/engine internals are exported from `funFact.ts` for this; the enumerator + `formatAuditReport`
live in `src/mapgen/features/funFactAudit.ts`.

---

## 3. Audit it (your judgment)

Read `/tmp/funfacts.txt`. The **grouped pair views are the high-signal unit** — far smaller than the 8k+
sentences, and nonsense shows up as a bad row under a predicate:

- **SUBJECT per PREDICATE**: for each predicate, scan its subject list. Does the predicate read sensibly
  after *every* subject? (e.g. *"its fish markets guard the only pass"* — no.)
- **QUALIFIER per PREDICATE**: for each predicate, scan its qualifier list. Does the trailing clause make
  sense? (e.g. *"…freezing for half the year during the spring fair"* — no.)

`grep` is your friend for spot-checking a suspicion against the full sentences, e.g.
`grep -i "its mines" /tmp/funfacts.txt`.

### Known nonsense taxonomy (what's already been fixed — look for *more* of these and new kinds)

1. **Stative predicate + temporal qualifier** — timeless qualities shouldn't take a "when". Fixed by
   `accepts: []`. (*"have stood for generations on market days"*)
2. **City-wide predicate + lone feature subject** — describes the settlement, not a feature. Fixed by
   `cityWide: true` on both predicate and a `the town`-style subject. (*"its dawn bells host more festivals"*)
3. **Self-timed / ratio predicate + any qualifier** — predicate already contains its time, or is a ratio
   claim. Fixed by `accepts: []`. (*"hums with looms from dawn to dusk before sunrise"*, *"hosts more
   festivals than working days before sunrise"*)
4. **Climate stative + qualifier** — climate facts are self-contained. Fixed by `accepts: []`. (*"colder
   than the maps admit during holy festivals"*)
5. **Frame mismatch in a single-slot pool** — entry doesn't complete its template. Fixed by rewording or
   moving to a slotless one-liner. (*"known across X as blessed with bad weather and good neighbors"*)
6. **Self-referential gate** — a qualifier referencing "the capital" reachable in a capital city. Fixed by
   adding `capital: false`. (*"long after the capital has gone to bed"* in the capital)
7. **Insider-access clause + public predicate** — *"if you know who to ask"* implies privileged access, so it
   can't trail a publicly-observable predicate. Fixed by splitting an `access` Fit out of `condition`: the
   clause is `fit: ["access"]`, accepted only by access predicates (`keeps odd hours`, `trades in
   everything …`). (*"impossible to find lodging in if you know who to ask"*, *"draws crowds … if you know who to ask"*)
8. **Predicate ↔ wrong feature-kind** — a predicate implying commerce/bustle/records lands on a feature that
   can't bear it. Fixed by the **subject-kind axis**: subjects carry `kind` (`market` / `industry` / `place` /
   `institution` / `landmark` / `rampart`), the offending predicates declare `attachTo`. Catches: an economy
   claim on a landmark (*"its bell tower anchors the local economy"*), a records claim off an institution
   (*"its orchards keep better records"*), and — after splitting `works`→`market`/`industry` — a gathering
   claim on a production site (*"its foundries draw crowds"*, *"its mines fill up with strangers"*). Landmarks
   and ramparts still reach stative/atmospheric lines plus `draws travelers` / `louder than visitors expect`
   (a landmark is a sight, and can be loud), so coverage holds.

---

## 4. Apply the fix (decision guide)

| If the combo is nonsense because… | Do this |
|---|---|
| predicate is a timeless quality / self-timed / ratio, qualifier is wrong | set predicate `accepts: []` |
| predicate is fine but only *some* qualifier categories fit | set predicate `accepts: ["seasonal", …]` |
| predicate describes the whole town, not a feature | set predicate `cityWide: true` (a cityWide subject already exists) |
| predicate implies commerce/bustle/records but lands on the wrong kind of feature | set predicate `attachTo: [...]` (the subject `kind`s that fit) |
| a part shows up in a city it shouldn't | tighten its `when` |
| a single-slot entry doesn't fit its frame | reword it, or move it to a slotless one-liner pattern |

Prefer the smallest lever. Adding/over-gating can violate the coverage invariant — keep one un-gated
member per `Fit` and per required slot, keep at least one predicate with no `attachTo` (so every subject
`kind` stays reachable), and don't gate the last predicate a given `kind` can reach.

---

## 5. Verify

```bash
# regression guard (no leaked tokens; fixed classes stay dead)
npx vitest run src/mapgen/features/funFactAudit.test.ts

# re-dump and confirm a specific fixed pattern is gone, e.g.
grep -ic "freezing for half the year during" /tmp/funfacts.txt   # expect 0

# whole project still typechecks + builds
npx tsc --noEmit
```

Add a new assertion to `funFactAudit.test.ts` for any nonsense class you fix, so it can't regress.

---

## 6. Known residual (not yet fixed — candidate for the next pass)

**`place` and `institution` are each two-faced** for the two gathering predicates (`draw crowds from every
village within a week's walk`, `fill up with strangers`). Both kinds mix crowd-drawing members (central
square, oldest tavern, temples, courts) with ones that aren't public destinations (garden terraces, noble
houses, parade grounds, barracks, ministry halls, governor's palace) — so a handful still read slightly off:
*"its noble houses fill up with strangers"*, *"its barracks draw crowds"*, *"its garden terraces fill up with
strangers"*. Mild (not contradictory like the fixed classes), so left.

The principled fix is a small **`public` facet** (a second tag, orthogonal to `kind`) that the two gathering
predicates require — or just splitting `place`→`square`/`grounds` and tightening those two `attachTo`s. Weigh
it against rewording the two predicates or accepting the residual; the offender list is now ~6 subjects.

---

## Files

- `src/mapgen/features/funFact.ts` — pools (`subject`/`predicate`/`qualifier`/…), patterns, and the
  `inflect` / `acceptsQualifier` / `acceptsSubject` / generation engine. Internals are exported at the bottom
  for the audit.
- `src/mapgen/features/cityCondition.ts` — `CityCondition`, `matchesCondition`, `tagsMatch`.
- `src/mapgen/features/funFactAudit.ts` — `enumerateReachableFunFacts()` (reachability-aware enumerator) and
  `formatAuditReport()`.
- `src/mapgen/features/funFactAudit.test.ts` — regression guard over the audited classes.
