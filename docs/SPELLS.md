# Spell Cards — Source Transcription

This document is a verbatim transcription of the **physical printed spell-card deck**
(source PDFs: `PELIKORTIT-20260810T095705Z-1-001/PELIKORTIT/` and
`Pelikortit-20260810T095715Z-1-001/Pelikortit/`, provided 2026-08-10).

## Implementation status

| Series    | Cards | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sarja1    | 5     | ✅ Implemented — `data/spells.json` entries `sarja1-k1`…`sarja1-k5`, dispatch/handlers in `spell-engine.js`, tests in `dev/tests/spell-engine-sarja1.test.js` (19 tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sarja2    | 5     | ✅ Implemented — new `charged_removal` effect type (Glock 17's 10-charge counter, `useChargedRemoval()`), first real `extra_placement` handler (`_handleExtraPlacement`, also retrofits the existing "Knowledge from the Deep" placeholder which previously did nothing), tests in `dev/tests/spell-engine-sarja2.test.js` (17 tests). Also fixed a pre-existing gap found along the way: `destroy_adjacent`'s board mutation (`spell_board_effect` log entries) was never added to `undo-manager.js`'s `UNDOABLE_TYPES`, so Get Away From Me / Calculated Aggression / sarja1-k2 were silently un-revertible via "Undo Last Action" — fixed, tests in `dev/tests/undo-manager-spell-board-effect.test.js` (6 tests). `spell_tiles_placed` (extra_placement's own log type) got the same undo treatment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sarja3    | 6     | ✅ Implemented — new `reposition` (move up to 5 own tiles), `reveal_hands` (one-time hand snapshot), and `first_heart_roll` (d6 table; outcomes 3 and 6 are real game-state changes, 1/2/4/5 are tracked reminders with no enforced rule elsewhere in the codebase to hook into) effect types; added a `getHexType()` passthrough on `BoardManager` so `SpellEngine` can distinguish the mountain heart from side hearts (also tightened `Katalyyttiavain`'s precondition to use it directly instead of relying only on admin attestation). `counter` effects now carry a `usesRemaining` count (both the Process path and the existing client-cast reminder path) so 3.6's outcome 3 can buff Taitava vastaisku. Tests: `dev/tests/spell-engine-sarja3.test.js` (20 tests) + `dev/tests/undo-manager-spell-placement-effects.test.js` (5 tests, covering `spell_tiles_placed`/`spell_tiles_repositioned`/`spell_hearts_transferred`/`spell_effect_charges_added`). A real bug surfaced by the tests: outcome 6's initial implementation would transfer *any* heart hex when no `boardManager` was wired (treating "unknown type" as "safe to transfer") — fixed to require an affirmative `'side-heart'` match instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sarja4    | 5     | ✅ Implemented — new `conditional_bonus` (admin-attested placement condition → fixed points+tiles reward, reuses `_placeTilesAt`), `placement_lockout` (tracked hex lock + `isHexLocked()` query — **enforcement not wired into board-manager.js's actual placement click yet**, same documented gap as the targetData input forms), `random_mass_removal` (d6 table, reuses `spell_board_effect` for undo), and `conditional_card_grab` (admin-attested trial → cross-team card transfer from any hand/usedPile/drawPile) effect types. Refactored `_handleExtraPlacement`'s placement loop out into a shared `_placeTilesAt()` helper so `conditional_bonus` could reuse it instead of duplicating placement logic. Tests: `dev/tests/spell-engine-sarja4.test.js` (15 tests) + 1 more in `undo-manager-spell-placement-effects.test.js` for `spell_cards_taken`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sarja5    | 5     | ✅ Implemented — the 4 overlapping placeholder ids (`get-away`, `elf-protection`, `all-according-plan`, `echo-silence`) kept their original ids (renaming would break spellId lookups for anything already cast in the two stored tournaments) but got their description text updated to the physical card wording, plus `deck`/`cardNumber`/`image` metadata. Two of those four went from purely informational to actually functional: `shield` is now enforced via a new `_isShielded()` check wired into every tile-destruction path (`_handleDestroyAdjacent`, `useChargedRemoval`, `_handleRandomMassRemoval`, and `extra_placement`'s `destroy_occupied` restriction) instead of just showing a reminder card; `copy_spell` now actually re-executes the copied spell via `executeSpellEffect()` (with a copy_spell → copy_spell recursion guard) instead of only creating a reminder. New `fill_adjacent_to_heart` effect type for the 5th, genuinely new card (`sarja5-k5`). Tests: `dev/tests/spell-engine-sarja5.test.js` (16 tests, including 5 dedicated to shield enforcement across all four destroy paths).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sarja6    | 9     | ✅ Implemented (9 unique cards; `Sarja6k10.pdf` confirmed a byte-identical duplicate of `k1`, not a real 10th card). New `heart_lock` (tracked lock on a specific heart hex + `isHeartLocked()` query — **enforcement not wired into board-manager.js's challenge/capture flow or result-manager.js's heart-income scoring yet**, same documented gap as `placement_lockout`) and `force_redraw` (pull a named card from a team's hand, draw their replacement **first**, then shuffle the exchanged card back in — full pile-snapshot undo since a shuffle can't be reversed by replaying it backwards). `bet` went from reminder-only to a real handler (`_handleBet`): admin reports how many of the pre-written predictions came true, reusing `points_awarded`/`spell_tiles_placed`/`spell_board_effect` for every mutation so it's undoable with no new undo type. Generalized `charged_removal` with an opt-out `requiresAdjacency: false` flag so Perus poisto (2 charges, any tile, no adjacency) can share `useChargedRemoval()` with Glock 17 instead of duplicating it. `rift-knowledge`, `betting-depths`, and `rematch` kept their ids, text updated to the physical wording. Two real bugs surfaced and fixed while building this batch: (1) `_calculateExpiry` never actually read `effect.duration`, so `placement_lockout` (Sarja4) had silently been expiring after 1 round instead of the card's stated 2 — now fixed generically for any card with an explicit duration; (2) `_handleForceRedraw` initially shuffled the exchanged card back into the draw pile *before* drawing the replacement, risking (would have been ~50/50 in the test's small pile) immediately redrawing the very card just given up — reordered to draw first, matching the card's own word order, with a 25-iteration regression test guarding it. Also caught and reverted my own overreach: I'd renamed `rematch`'s `name` from "Uusinta" to "Rematch" to match the physical card's literally-English title, which broke a pre-existing test pinning "Uusinta" as the established name for this already-shipped card — reverted the name, kept the description update. Tests: `dev/tests/spell-engine-sarja6.test.js` (18 tests) + 2 more in `undo-manager-spell-placement-effects.test.js`. |
| Named (8) | 8     | ✅ Implemented — the final batch. New `temporary_capture` (immediate capture of 2 adjacent opponent tiles, auto-removed from the game entirely after 2 rounds — extended `expireConditions()` with a generic `removeCoordsOnExpiry` mechanism to support this), `reposition` + new `requiresConnectedFormation` precondition (Rintama vaihtuu's 3-tile formation move — "rotate" needs no special-case hex-rotation math since the admin states each tile's destination directly), `blind_card_swap` (two independent `Math.random()`-based swaps — genuinely random, not an admin judgment call), and `win_streak_bonus` (admin-attested streak level, same one-shot-confirmation treatment the very first design round chose for Domination x3). Three cards got the same "track the condition, expose real primitives, don't auto-enforce" treatment already established for `placement_lockout`/`heart_lock`: `forced_removal_condition` (`hasForcedRemovalObligation()` + `applyForcedRemoval()`), `marked_relocation_charge` (mark now via `markTileForRelocation()`, resolve later via `resolveMarkedRelocation()` — the "later" trigger has no hook), and `piggyback_condition` (`grantPiggybackPlacement()`). `evasion_condition` got the most conservative treatment of the batch: `_hasEvasion()` and `_findEvasionHex()` are real, tested detection primitives, but deliberately **not** wired into the three already-shipped, already-tested destroy paths (`_handleDestroyAdjacent`/`useChargedRemoval`/`_handleRandomMassRemoval`) — retrofitting a redirect-instead-of-destroy branch into all three risked a subtle regression in tested code this late in an unattended pass; wiring them in is a good, bounded follow-up. Tests: `dev/tests/spell-engine-named-cards.test.js` (26 tests) + 3 more in `undo-manager-spell-placement-effects.test.js`. One real bug caught and fixed by the tests: `_undoSpellBlindSwap` originally reversed its two swaps in cast order instead of reverse-cast order, so when the caster's own swap touched the same pile as the teamA/teamB swap, undoing silently clobbered the wrong value — fixed to reverse in the opposite order they were applied.                                                                                   |

**All 43 unique physical cards are now implemented and tested.** 488/488 tests pass (stable across repeated runs, including the two effect types with genuine randomness — `first_heart_roll`'s d6 and `blind_card_swap`'s swap selection). Every board/point mutation across the whole deck logs through one of a small set of reusable, already-undoable action types (`spell_board_effect`, `spell_tiles_placed`, `spell_tiles_repositioned`, `spell_hearts_transferred`, `spell_effect_charges_added`, `spell_cards_taken`, `spell_forced_redraw`, `spell_tiles_captured`, `spell_marked_tiles_relocated`, `spell_blind_swap`, or the pre-existing `points_awarded`) — no card introduced a mutation that bypasses "Undo Last Action".

Execution model established with Sarja1: everything routes through the admin "Process" step in
god.html (same pattern the existing Rematch spell already used) — casting from team.html only
logs the cast + an informational reminder card where applicable; `PROCESSABLE_EFFECT_TYPES` in
`spell-engine.js` lists which effect types get a Process button and actually mutate board/points
state when clicked.

## Follow-ups (not closed in this pass)

1. **Admin UI input forms.** Every new effect type's engine-side handler is complete and tested,
   but god.html has no input UI yet for the `targetData` most of them need (hex coordinates, a
   discard/pick choice, various admin attestations, which effect to spend a charge against).
   Needs its own design pass across the ~30 distinct `targetData` shapes now in use, rather than
   one bespoke prompt per card.
2. **Cross-cutting enforcement not wired in**, tracked via query methods only: `isHexLocked()`
   (placement_lockout), `isHeartLocked()` (heart_lock), `hasForcedRemovalObligation()`,
   `_hasEvasion()`/`_findEvasionHex()` (evasion_condition — 3 already-tested destroy paths would
   need a redirect branch added). Each of these needs a hook into board-manager.js's placement
   click, the challenge/capture flow, or result-manager.js's match-confirm flow to become
   self-enforcing instead of admin-checked.
3. **`Sarja6k10.pdf` duplicate** — confirmed, not chased further (see earlier resolved decision).

Today, `targetData` for every Process-gated effect type can only reach `executeSpellEffect` via a
test harness or by hand-editing Firestore — a real admin can't drive any of these cards
end-to-end through god.html's UI yet (follow-up 1 above).

It supersedes the 15-card placeholder set currently in `BoardGame/data/spells.json` /
`BoardGame/docs/guides/SPELL_REFERENCE.md` / `BoardGame/rulebook.html` — those were an
earlier, smaller digital-only draft. Four of the placeholder cards turn out to be near-exact
matches for cards in Sarja5 (Get Away From Me, Elf Protection, Echo of Silence, All According
to My Plan), confirming the placeholder set was drawn from this physical deck, not invented
independently.

**Status: transcription only.** Text below is copied character-for-character from the card
images, including apparent typos on the physical cards (marked with `[sic]`). Nothing has been
interpreted, normalized, or mapped to a game mechanic yet — that's the next step, and several
cards need a ruling from you before they can be implemented (see "Open questions" at the end).

No card in the deck uses "ultimate"/one-time/game-ending language (checked for "lopullinen",
"viimeinen", "kertaalleen", "ultimate", and equivalents) — if you had a specific "ultimate rule"
in mind, it isn't in this deck as transcribed; flag it and I'll fold it in separately.

## Image assets

Juha designed these cards to double as the printable physical deck, so the digital version
must be a 1:1 visual reproduction, not a re-themed HTML card. All 43 unique card faces plus the
shared card back have been rasterized from the source PDFs (392×533 PNG, ~350–460KB each, ~18MB
total) into `BoardGame/shared/images/spell-cards/`, one file per card, named by series+number
(`sarja1-k1.png` … `sarja6-k9.png`, `named-n1.png` … `named-n8.png`, `card-back.png`).
`sarja6-k10` was intentionally skipped — see open question 1. These are the canonical visuals to
use in team.html/god.html; nothing needs to be redrawn.

## Deck structure

Six numbered series ("Sarja" 1–6), 5–10 cards each, plus 8 individually-named cards (named
after players in the filename, but the card text itself is generic — none of the 8 reference a
specific person by name on the card face). 44 source files, 43 unique cards (`Sarja6k10.pdf` is
a byte-identical duplicate of `Sarja6k1.pdf` — see open questions).

---

## Sarja 1

### 1.1 — Vuori Puhuu
> Pelaa välittömästi uudelleen kaikki käytettyjen korttien pakassa olevat loitsut

*(EN gloss: Immediately replay all spells in the used-card pile.)*

### 1.2 — harkittu agressio
> Aseta yksi laatta laudalle, tuhoa kaikki viereiset vastustajien laatat

*(EN gloss: Place one tile on the board; destroy all adjacent opponent tiles. Near-match for
the current placeholder "Calculated Aggression".)*

### 1.3 — Juho Puhuu
> Valitse pelaaja. hän pelaa seuraavan ottelun kuulokkeissa häiritsevää taustamelua

*(EN gloss: Choose a player. They play the next match with disruptive background noise in
their headset.)*

### 1.4 — Sabotaasia
> Valitkaa vastustajatiimi. Määrittäkää yksi pelattava asia (hahmoluokka, aselaji, rotu),
> kyseinen tiimi ei saa käyttää sitä seuraavassa pelissä

*(EN gloss: Choose an opponent team. Name one playable thing (character class, weapon type,
race) that team may not use in the next game. Near-match for placeholder "Sabotage".)*

### 1.5 — Kiven Muisti
> Seuraavan kerran kun nostatte kortin loitsupakasta, nostakaa yksi lisää

*(EN gloss: Next time you draw a card from the spell deck, draw one extra. Matches placeholder
"Double Bid"/`double-bid` mechanically, different flavor text.)*

---

## Sarja 2

### 2.1 — Glock 17
> Kortti jää pöytään 10. ammusmerkillä. Kuluta yksi ammus merkki kortilta voit poistaa
> vastustajan laatan joka koskettaa omiasi. Kun kaikki ammukset on käytetty kortti poistuu
> pelistä

*(EN gloss: Card stays on the table with 10 ammo markers. Spend one ammo marker to remove an
opponent tile touching your own. When all ammo is spent, the card leaves play. — Persistent,
multi-use, consumable-counter card; no existing analog.)*

### 2.2 — Sattuma puuttuu peliin
> Pelaa ennen toteutusta. Korvaa tapahtuman valinta satunnaisella sallituista. Numeroi
> vaihtoehdot ja anna sattunais generaattorin tehdä päätös

*(EN gloss: Play before resolution. Replace an event's choice with a random one from the
allowed options. Number the options and let a random-number generator decide.)*

### 2.3 — huomaamatta ohi
> Kun asetat uuden laatan, heitä d6. Saat asettaa laatan 1-6 ruutua lähimmästä omasta
> laatastasi. Kortti jää eteesi 2 käyttökertaa.

*(EN gloss: When you place a new tile, roll a d6. You may place the tile 1–6 hexes from your
nearest own tile. Card stays in front of you for 2 uses.)*

### 2.4 — Taikuuden nälkä
> Poista kädestäsi yksi loitsu, aseta kaksi laattaa

*(EN gloss: Discard one spell from your hand, place two tiles.)*

### 2.5 — Katalyyttiavain
> Pelaa vain, kun hallussa vuoren sydän. Aktivoituu 1. vuoron ajan. Laatat voi asettaa mihin
> tahansa vapaaseen ruutuun. Kulutus: aseta 6 laattaa mihin tahansa,tuhoa vastustajan laatta
> alta

*(EN gloss: Only playable while holding Mountain's Heart. Active for 1 turn. Tiles may be
placed on any free hex. Cost/consumption: place 6 tiles anywhere, destroying the opponent tile
beneath each. — Highest-power card seen so far; requires holding the center.)*

---

## Sarja 3

### 3.1 — Jäljitys
> Jos teidän laattanne koskettaa toisen joukkueen laattaa voitte asettaa kaksi laattaa
> vastustaja joukkueen laattojen viereen

*(EN gloss: If your tile touches another team's tile, you may place two tiles adjacent to that
opponent team's tiles.)*

### 3.2 — Tiedä vihollisesi
> Määrä vastustaja joukkueen roolit, sijainnit, rodut / mikä tahansa päätettävissä oleva
> asia.

*(EN gloss: Demand the opponent team's roles, positions, races / any other decidable
information.)*

### 3.3 — Parempi reitti
> Voitte uudelleen asettaa max 5. Joukkueenne laattaa

*(Transcribed exactly as printed — the sentence is incomplete/unpunctuated on the card itself,
not a transcription error. EN gloss: You may re-place up to 5 of your team's tiles.)*

### 3.4 — Taitava vastaiksu[sic]
> Estä vastustajan pelaama taika toteutumasta

*(Card title itself is misspelled on the physical card — K6 below refers to this same card
correctly as "taitava vastaisku". EN gloss: Prevent an opponent's played spell from resolving —
i.e. a counterspell.)*

### 3.5 — Kysy yrteiltä
> Katso jokaisen joukkueen kädessä olevat kortit

*(EN gloss: Look at every team's hand of cards.)*

### 3.6 — Kaikki alkoi kivestä (THIS SPELL IS OUTDATED AND REMOVED!)
> Kun valtaatte sivusydämen ensimmäistä kertaa, laita 1 merkki
>
> 1 – laatan asetusetäisyys +1
> 2 – voitte korvata laatan asetuksen kortin nostolla
> 3 – taitava vastaisku +1 käyttö lisää
> 4 – poista 1 vastustajan viereinen laatta kun asetatte omanne
> 5 – voitte haastaa vuorensydämiä ilman laatan asettamista
> 6 – kaikki sivusydämmet siirtyvät hallintaanne

*(EN gloss: When you capture a side-heart for the first time, roll a d6 for one of 6 outcomes
[confirmed random, not team's choice]: 1 tile-placement range +1; 2 you may replace a tile
placement with a card draw; 3 "Taitava vastaisku" [3.4] gets +1 extra use; 4 remove 1 adjacent
opponent tile when you place your own; 5 you may challenge for mountain hearts without placing a
tile; 6 all side-hearts transfer to your control. Outcome 6 is the single most powerful effect
found in the deck — an instant board-wide side-heart sweep.)*

---

## Sarja 4

### 4.1 — Ylimielistä tietoa
> Jos tiimin jäsenet ovat seuraavassa pelissä voittavassa joukkueessa pistesijoituksissa
> paras tai toiseksi paras 2 laattaa ja 2 pisteet

*(EN gloss: If the team's members are, in the next game, best or second-best by score placement
within the winning team, [get] 2 tiles and 2 points. Near-match for placeholder "Double Glow".)*

### 4.2 — Älä tule lähemmäs
> Valitkaa kolme tyhjää ruutua jotka teidän laattojenne vieressä. Niihin ei voi asettaa laattaa
> seuraavien kahden vuoron aikana

*(EN gloss: Choose three empty hexes adjacent to your tiles. No tile may be placed there for
the next two turns.)*

### 4.3 — Epävakaa loitsu
> heitä d6. Numeroikaa tiimit 1-5. 1-5 poista kyseiseltä tiimiltä 3 laattaa. 6: poista kaikilta
> muilta tiimeiltä kuin teiltä 2. laattaa

*(EN gloss: Roll d6. Number teams 1–5. On 1–5, remove 3 tiles from that team. On 6, remove 2
tiles from every team except yours.)*

### 4.4 — Mielen siirto
> Valitkaa kaksi pelaajaa; he vaihtavat keskenään paikkansa (tietokoneet / tuolit) seuraavaan
> otteluun.

*(EN gloss: Choose two players; they swap places (computers/seats) for the next match.)*

### 4.5 — Magian keskittymä
> 5. vuoron koeaika. Valtaa Vuoren Sydän ja pidä hallussa 2 vuoroa. Onnistut: ota 6
> loitsukorttia mistä tahansa joukkueista — kädestä, poistopakasta tai nostopakan päältä.
> Epäonnistut: kortti poistuu ilman vaikutusta

*(EN gloss: 5-turn trial period. Capture Mountain's Heart and hold it for 2 turns. Success: take
6 spell cards from any teams — from hand, discard pile, or top of draw pile. Failure: card
leaves play with no effect.)*

---

## Sarja 5

*(This series maps closely onto 4 of the 5 current placeholder pre-game/defensive spells.)*

### 5.1 — Kaikki on minun suunnitelmaani
> Valitse yksi vastustajien kortti käytettyjen korttien pakoista pelaa se välittömästi omana
> korttinasi

*(Matches placeholder "All According to My Plan" — `copy_spell`.)*

### 5.2 — Haltiasuoja
> Pelatkaa hävityn ottelun jälkeen. Teihin ei voi kohdistaa negatiivisia efektejä ennen
> seuraavan ottelun loppua

*(Matches placeholder "Elf Protection" — `shield`. Note: this version protects the TEAM from
negative effects, it does not explicitly say tiles are protected from destruction — narrower
than the current placeholder's `protects: ["tiles", "negative_effects"]`.)*

### 5.3 — Irti minusta
> Jos tiiminne voittaa seuraavan pelin, kaikki vastustajien laatat jotka koskevat omianne
> tuhotaan pelin jälkeen

*(Matches placeholder "Get Away From Me" — `destroy_adjacent` conditional on winning.)*

### 5.4 — Hiljaisuuden kaiku
> Valitkaa yksi pelaaja mistä tahansa tiimistä hän ei saa puhua lainkaan seuraavan pelin aikana

*(Matches placeholder "Echo of Silence" — `silence`.)*

### 5.5 — Muinaiset puolustusmekanismit
> Pelaa heti sydämen valtauksen jälkeen. Täyttäkää valtaamanne sydämen kaikki
> viereiset alueet laatoillanne

*(EN gloss: Play immediately after capturing a heart. Fill all hexes adjacent to the heart you
just captured with your own tiles.)*

---

## Sarja 6

### 6.1 — Nyt pelataan Spellbreak
> Seuraava peli on spellbreak yliajaa kaikki muut pelin valintaa koskevat tapahtumat.
> 2 käyttökertaa

*(EN gloss: The next game is Spellbreak — overrides any other game-selection events. 2 uses.)*

### 6.2 — Lukossa
> Valitse vuoren sydän, se on seuraavat kaksi vuoroa lukossa. Sitä ei voi haastaa, vallata, eikä
> se tuota voittopisteitä, tai edistä loitsuja

*(EN gloss: Choose Mountain's Heart — it is locked for the next two turns. It cannot be
challenged, cannot be captured, and does not generate victory points or advance spells.)*

### 6.3 — Samat senssit
> Valitse tiimistäsi pelaaja ja toinen vastustaja pelaaja. Molemmat käyttävät määrittämiäsi
> hiiri asetuksia

*(EN gloss: Choose a player from your team and one opposing player. Both must use mouse
settings you specify.)*

### 6.4 — Vaihtoon
> Valitse kortti, sen omistaja nostaa uuden kortin pakastaan, laittaa valitun kortin
> nostopakkaan ja sekoittaa sen

*(EN gloss: Choose a card; its owner draws a new card from their deck, puts the chosen card into
the draw pile, and shuffles it.)*

### 6.5 — Me halutaan pelata omia pelejä
> Valitse seuraava pelattava peli, sekä päätä joukkue kokoonpano peliin

*(EN gloss: Choose the next game to be played, and decide the team composition for it.)*

### 6.6 — Syvän tiedon kuilu
> Valitkaa vastustaja tiimi. heidän nostaessa kortin voitte katsoa mikä se on ja päättää
> estättekö sen noston

*(Matches placeholder "Rift of Deep Knowledge" — `counter`.)*

### 6.7 — Vedonlyöntiä syvyyksissä
> Kirjoittakaa lapulle. Kumpi tiimi voittaa, kenellä on parhaat statsit, kenellä on huonoimmat.
> Jos oikein +1 laatta ja voittopiste, jos kaikki väärin tuhotkaa 2 omaa laattaa laudalta

*(Matches placeholder "Betting from the Depths" — `bet`, but only 2 predictions worded here
[which team wins, best/worst stats] vs. the placeholder's 3 [win/most damage/most deaths] —
close but not identical wording.)*

### 6.8 — Perus poisto
> Poista laatta laudalta. Kaksi käyttökertaa

*(flavor text on card: "rotat paskoo taas tavaraa". EN gloss: Remove a tile from the board. Two
uses.)*

### 6.9 — Rematch
> Pelaa aikaisempi peli uudelleen, kaikki efektit pysyvät, aikaisempi tulos mitätöityy

*(Matches placeholder "Rematch" — `rematch`, already implemented in `spell-engine.js`. Note the
extra clause not in the current implementation: "kaikki efektit pysyvät" — all [active] effects
stay/persist across the replayed match. Current `_handleRematch` doesn't touch `activeEffects`
at all, so this may already be satisfied by default — needs confirming against the full revert
path.)*

### 6.10 — [duplicate file]
`Sarja6k10.pdf` is a byte-identical copy of `Sarja6k1.pdf` (confirmed via MD5). Not a distinct
card — see open questions.

---

## Named cards

*(Filenames are player names; the card text itself is generic, no card names a specific
player.)*

### N.1 — Katso kuinka se kuolee *(1Hilma.pdf)*
> Valitse joukkue. Kahden vuoron ajan sen on poistettava yksi oma laattansa jokaisen häviämänsä
> pelin jälkeen.

*(EN gloss: Choose a team. For two turns, they must remove one of their own tiles after every
game they lose.)*

### N.2 — Vettähän se vain oli *(Jussi1.pdf)*
> 2 käyttöä. Merkitse käytöllä mikä tahansa laatta. Pelivoiton laatanpoistolla kaikki merkityt
> laatat siirtyvät viereiseen ruutuun, poistavat siellä olevan laatan ja aktivoivat
> asetussäännön.

*(EN gloss: 2 uses. Each use marks any tile. On a game-win tile-removal, all marked tiles move
to an adjacent hex, destroying whatever's there and triggering the normal placement rule.)*

### N.3 — Epävakaa todellisuus *(Luttinen1.pdf)*
> Valitse kaksi vastustajan laattaa, jotka koskettavat toisiaan ja vähintään yhtä joukkueenne
> laattaa. Ottakaa laatat hallintaanne. Kahden vuoron kuluttua ne poistuvat pelistä.

*(Title confirmed as "Epävakaa todellisuus". EN gloss: Choose two opponent tiles that touch each
other and touch at least one of your team's tiles. Take control of them. After two turns, they
are removed from the game.)*

### N.4 — Rintama vaihtuu *(Miikka1.pdf)*
> Valitse kolmen oman vierekkäisen laatan muodostelma. Siirrä ja halutessasi käännä se mihin
> tahansa vapaaseen kohtaan. Laatat aktivoivat asetussäännön.

*(EN gloss: Choose a formation of 3 of your own adjacent tiles. Move it, and optionally rotate
it, to any free location. Tiles trigger the normal placement rule.)*

### N.5 — Rinnalla loppuun asti *(Rony1.pdf)*
> Valitse toinen joukkue. Kahden vuoron ajan aina, kun se asettaa laattoja, joukkueenne saa
> asettaa yhtä monta laattaa.

*(EN gloss: Choose another team. For two turns, whenever they place tiles, your team may place
an equal number of tiles.)*

### N.6 — Vaistonvarainen väistö *(pauliina1.pdf)*
> Pelaa, kun teihin kohdistetaan negatiivinen efekti. Kolmen vuoron ajan poistettava laattanne
> siirtyy vapaaseen ruutuun kauemmas poistajan laatoista. Ellei siirto onnistu, laatta poistuu.

*(EN gloss: Play when a negative effect targets you. For three turns, a tile of yours that would
be removed instead moves to a free hex farther from the remover's tiles. If no such move is
possible, the tile is removed as normal.)*

### N.7 — Tuhoa suunnitelmat *(teemu1.pdf)*
> Valitse kaksi joukkuetta vaihtamaan kortti sokkona. Vaihtakaa sitten kortti valitsemanne
> joukkueen kanssa: valitsette oman korttinne, heidän korttinsa valitaan sokkona. Kaikki
> vaihdetut kortit palautuvat alkuperäisiin käsiin käytön jälkeen tai kahden vuoron kuluttua.

*(EN gloss: Choose two teams to swap a card blind [with each other]. Then swap a card with your
chosen team: you choose your own card, theirs is chosen blind. All swapped cards return to their
original hands after use or after two turns.)*

### N.8 — Priimus *(ville11.pdf)*
> Toisesta peräkkäisestä voitostanne saatte asettaa yhden ylimääräisen laatan ja kolmannesta
> kaksi. Vaikutus päättyy ensimmäiseen häviöönne tai kolmanteen peräkkäiseen voittoonne.

*(EN gloss: From your 2nd consecutive win, place one extra tile; from your 3rd, two extra. Effect
ends at your first loss or your 3rd consecutive win. Near-match for placeholder "Domination x3",
but rewards tiles progressively per-win rather than a single lump bonus at win #3.)*

---

## Resolved decisions

1. **`Sarja6k10.pdf` duplicate.** Confirmed: Sarja6 has 9 unique cards. The 10th file was a
   scanning duplicate, not a missing card. `sarja6-k10.png` was not generated.
2. **Relationship to the existing 15-spell placeholder set.** Confirmed: physical card text is
   the source of truth wherever it conflicts with the current digital placeholder wording/numbers
   (e.g. Betting from the Depths uses 6.7's 2 predictions, not the placeholder's 3; Double Glow
   follows 4.1's wording).
3. **Sarja3.6 ("Kaikki alkoi kivestä") resolution mechanic.** Confirmed random: roll a d6 for
   one of the 6 outcomes, not the team's free choice. The 3.6↔3.4 link (outcome 3 grants "Taitava
   vastaisku" an extra use) and the N.2/N.4 "normal placement rule" references still need the
   underlying placement/heart-capture rules nailed down at implementation time, card by card.
4. **Real-world/non-board mechanics** (mouse sensitivity 6.3, headset noise 1.3, player seat
   swaps 4.2, "which game gets played next" 6.5/6.1, paper betting slips 6.7): confirmed
   informational-reminder-only, same pattern as the already-shipped `ban`/`silence` cards. No
   board automation needed for these.
5. **Sarja2K5 wording fix.** "vapaasen" corrected to the standard spelling "vapaaseen" (my
   transcription slip, not a printed typo — see 2.5 above, now corrected).
6. **Rematch "kaikki efektit pysyvät" clause.** Confirmed already satisfied: the current
   `_handleRematch` revert path doesn't touch `activeEffects` at all, so active effects already
   survive a rematch revert untouched. No code change needed here.

Two spelling inconsistencies remain, transcribed verbatim as genuinely printed on the cards (not
transcription errors): "joukkoe-" (missing "u") throughout Sarja3, and "sydämmen" (double m)
throughout Sarja5/Sarja6 — consistent enough to be the deck's own house style.
