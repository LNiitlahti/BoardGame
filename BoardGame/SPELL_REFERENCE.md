# 🔮 Spell Card Reference Guide

Complete reference for all 15 spell cards in the BoardGame system.

---

## 📚 Table of Contents
- [Spell Categories](#spell-categories)
- [All Spells](#all-spells)
- [Strategic Guide](#strategic-guide)
- [Spell Interactions](#spell-interactions)

---

## 🎯 Spell Categories

### By Type
- **Pre-Game** (4): Cast before match starts
- **Instant** (2): Cast immediately when conditions met
- **Tactical** (1): Strategic moment casting
- **Defensive** (1): Protection after loss
- **Aggressive** (1): Offensive tile removal
- **Other** (6): Special mechanics

### By Rarity
- **Common** (9): Standard power level
- **Uncommon** (4): Stronger effects
- **Rare** (2): Game-changing power

### By Target
- **Self** (6): Benefit your team
- **Opponent** (4): Hinder enemy teams
- **Board** (2): Affect game board
- **Mixed** (3): Variable targets

---

## 📖 All Spells

### 1. Kaksinkertainen loisto / Ylivallan aura
**Double-sided Glow / Aura of Supremacy**

- **Type:** Pre-Game
- **Rarity:** Common
- **Target:** Self
- **Effect:** If you finish 1st or 2nd place in winning race, gain 2× victory points and 2× tiles after game
- **When to Use:** Before important matches where you expect to perform well
- **Strategic Value:** High risk, high reward - doubles your rewards if you do well

**Example:**
```
Normal: Win match → Get 10 points + 1 tile
With Spell: Win match → Get 20 points + 2 tiles (if 1st/2nd place)
```

---

### 2. Irti minusta!
**Get Away From Me!**

- **Type:** Pre-Game
- **Rarity:** Common
- **Target:** Opponents
- **Effect:** If your race wins the game, destroy all opponent tiles touching your tiles after game
- **When to Use:** When you have tiles surrounded by enemies and expect to win
- **Strategic Value:** Excellent for clearing contested border areas

**Example:**
```
Before:  [Enemy][Your Tile][Enemy]
After:   [Empty][Your Tile][Empty]
```

---

### 3. Domination! Domination! Domination!
**Domination! Domination! Domination!**

- **Type:** Rare Treasure
- **Rarity:** Rare
- **Target:** Self
- **Effect:** If you're in winning race for 3 games in a row after casting, gain 2 extra tiles + 2 extra victory points
- **When to Use:** When you have momentum and expect a win streak
- **Strategic Value:** Very powerful if you can maintain streak

**Streak Tracker:**
```
Cast spell → Win 1 (1/3) → Win 2 (2/3) → Win 3 (3/3) → Bonus Activates!
If you lose: Streak resets, must cast spell again
```

---

### 4. Haltiasuoja
**Elf Protection**

- **Type:** Defensive
- **Rarity:** Uncommon
- **Target:** Self
- **Effect:** After losing any match, protect all your tiles until end of next game. Immune to negative card effects until next round ends.
- **When to Use:** After losing important match to prevent further damage
- **Strategic Value:** Essential defensive spell, save for critical moments

**Protection Includes:**
- ✅ Tiles can't be destroyed
- ✅ Tiles can't be replaced
- ✅ Can't be targeted by negative spells
- ✅ Immune to board wipes
- ⏱️ Lasts until end of next game

---

### 5. Kaikki on minun suunnitelmaani
**All According to My Plan**

- **Type:** Tactical
- **Rarity:** Rare
- **Target:** Opponent Card
- **Effect:** Copy any used spell from another team and cast it immediately as your own
- **When to Use:** After opponent casts powerful spell
- **Strategic Value:** Can turn opponent's strength into your advantage

**Restrictions:**
- Spell must be currently usable (timing-wise)
- Spell must have been cast by opponent this round
- You choose new targets for the copied spell

---

### 6. Täytä sopimus
**Complete the Contract**

- **Type:** Challenge
- **Rarity:** Uncommon
- **Target:** Center (Mountain Heart)
- **Effect:** Challenge for Mountain's Heart control. If you win challenge, gain 2 victory points + place 1 tile next to center (replacing enemy tile if needed)
- **When to Use:** When you're ready to contest center control
- **Strategic Value:** High-stakes play for central board control

**Challenge Resolution:**
- Admin determines winner based on match performance
- Win: Gain 2 points + center-adjacent tile
- Lose: No penalty (spell still consumed)

---

### 7. Vuoren puhdistus
**Mountain Purification**

- **Type:** Instant
- **Rarity:** Common
- **Target:** Self
- **Effect:** Immediately after placing tile, gain 1 victory point for each heart hex you control
- **When to Use:** When you control multiple heart hexes
- **Strategic Value:** Simple point boost, best when controlling 3+ hearts

**Point Calculation:**
```
Control 0 hearts: +0 points
Control 1 heart:  +1 point
Control 3 hearts: +3 points
Control 6 hearts: +6 points (maximum possible)
```

---

### 8. Harkittu aggressio
**Calculated Aggression**

- **Type:** Aggressive
- **Rarity:** Uncommon
- **Target:** Adjacent Enemies
- **Effect:** Place 1 tile. If it touches enemy tiles, destroy all adjacent enemy tiles.
- **When to Use:** When enemy has valuable tiles clustered together
- **Strategic Value:** Can destroy multiple enemy tiles with one placement

**Example:**
```
Before: [Enemy1][Enemy2]
             [Empty]
After:  [Empty][Empty]
          [Your Tile]
Result: Destroyed 2 enemy tiles!
```

---

### 9. Sabotaasia
**Sabotage**

- **Type:** Debuff
- **Rarity:** Uncommon
- **Target:** Opponent Team
- **Effect:** Choose 1 opponent team. Ban 1 game element (weapon, hero, ability, etc.) for their next game.
- **When to Use:** Before important enemy match
- **Strategic Value:** Can significantly handicap opponent team

**Ban Examples:**
- CS2: Ban AWP (no snipers)
- Dota 2: Ban specific hero
- Valorant: Ban agent/map
- Starcraft: Ban specific unit

---

### 10. Kaksoisnosto
**Double Bid**

- **Type:** Event Modifier
- **Rarity:** Uncommon
- **Target:** Self
- **Effect:** Next time you place tile on draw hex, draw 2 event cards instead of 1
- **When to Use:** Before attempting to land on draw hex
- **Strategic Value:** Increases your card advantage

**Mechanic:**
- Spell has 1 charge
- Activates automatically on next draw hex placement
- Draw 2 cards, choose which to keep or use both
- Spell consumed after use

---

### 11. Voitonlyönti
**Victory Strike**

- **Type:** Permanent Buff
- **Rarity:** Rare
- **Target:** Self
- **Effect:** For rest of entire game, each new heart capture grants +1 bonus victory point
- **When to Use:** Early game for maximum benefit
- **Strategic Value:** Snowball effect if you capture many hearts

**Permanent Effect:**
```
Normal: Capture heart → Control heart
With Spell: Capture heart → Control heart + Instant +1 point

Capture 5 hearts over game → 5 bonus points!
```

---

### 12. Knowledge from the Deep

- **Type:** Placement
- **Rarity:** Uncommon
- **Target:** Board
- **Effect:** Place 2 tiles anywhere on board. Restrictions: Not next to hearts, not next to enemy tiles
- **When to Use:** To rapidly expand your territory
- **Strategic Value:** Powerful territory control, but restrictive placement

**Placement Rules:**
- ✅ Can place anywhere on empty hexes
- ❌ Cannot be adjacent to Mountain Heart
- ❌ Cannot be adjacent to Side Hearts
- ❌ Cannot be adjacent to any enemy tiles
- ✅ Can be adjacent to your own tiles

---

### 13. Hiljaisuuden kaiku
**Echo of Silence**

- **Type:** Debuff
- **Rarity:** Uncommon
- **Target:** Single Player
- **Effect:** Choose 1 player who cannot use microphone or speak during entire next game
- **When to Use:** Against teams with strong communication
- **Strategic Value:** Disrupts team coordination

**Silence Rules:**
- Player can't use voice chat
- Player can't speak in person
- Lasts for 1 complete game
- Text chat allowed (if applicable)
- Penalties for breaking silence (admin discretion)

---

### 14. Vedonlyöntiä syyvyksistä
**Betting from the Depths**

- **Type:** Bet
- **Rarity:** Uncommon
- **Target:** Self (with predictions)
- **Effect:** Before game, make 3 predictions. Each correct prediction = +1 point + 1 tile. All wrong = lose 2 tiles.
- **When to Use:** When you're confident about match outcome
- **Strategic Value:** High risk/reward gambling mechanic

**Betting Slip:**
```
Prediction 1: Which team wins? _______
Prediction 2: Who gets most kills? _______
Prediction 3: Who dies most? _______

Scoring:
0/3 correct: Lose 2 tiles from board
1/3 correct: +1 point, +1 tile
2/3 correct: +2 points, +2 tiles
3/3 correct: +3 points, +3 tiles
```

---

### 15. Syvän tiedon rako
**Rift of Deep Knowledge**

- **Type:** Counter
- **Rarity:** Rare
- **Target:** Opponent Event Draw
- **Effect:** Keep this card until used. When opponent draws event card, you may read it and prevent them from using it (send to discard pile)
- **When to Use:** Save for critical opponent draws
- **Strategic Value:** Ultimate counter spell, one-time use

**Counter Timing:**
```
1. Opponent lands on draw hex
2. Opponent draws card (face down)
3. You activate this spell
4. You see their card
5. Choose: Let them keep it OR Counter it
6. If countered: Card goes to discard, not played
7. This spell is consumed
```

---

## 🎯 Strategic Guide

### Early Game Spells (Rounds 1-3)
**Best Choices:**
1. Victory Strike - Permanent point generation
2. Sabotage - Disrupt enemy early advantage
3. Knowledge from Deep - Rapid territory expansion

**Avoid:**
- Elf Protection (nothing to protect yet)
- Betting spells (unpredictable early)

### Mid Game Spells (Rounds 4-6)
**Best Choices:**
1. Mountain Purification - Cash in on heart control
2. Calculated Aggression - Break enemy formations
3. Complete Contract - Contest key positions

**Save:**
- Rift of Knowledge (for late game)
- Elf Protection (for potential losses)

### Late Game Spells (Rounds 7+)
**Best Choices:**
1. Double Glow - Maximize final match rewards
2. Get Away From Me - Clear winning path
3. Elf Protection - Protect your lead

**Emergency Use:**
- All According to Plan - Copy winning strategy
- Rift of Knowledge - Counter game-winning play

---

## ⚔️ Spell Interactions

### Combos
**Mountain Purification + Victory Strike:**
- Capture heart → +1 from Victory Strike
- Use Mountain Purification → +1 more
- Total: 2 points from 1 heart capture!

**Calculated Aggression + Get Away From Me:**
- Destroy enemies with Calculated Aggression
- Win match with Get Away From Me active
- Clear massive territory!

### Counters
**Against Elf Protection:**
- Wait for protection to expire
- Use point-based strategies instead of tile removal
- Use Sabotage before they can cast it

**Against Silence:**
- Prepare hand signals pre-game
- Use simple yes/no communication
- Practice with your partner beforehand

**Against Rift of Knowledge:**
- Bait it with less important draws
- Draw multiple cards quickly if possible
- Assume all draws may be countered

---

## 📊 Spell Power Rankings

### Top Tier (Always Good)
1. Victory Strike - Game-changing permanent buff
2. Rift of Knowledge - Ultimate control
3. Elf Protection - Best defensive tool

### High Tier (Very Strong)
4. Double Glow - Huge reward potential
5. All According to Plan - Versatile adaptation
6. Domination x3 - Snowball potential

### Mid Tier (Situational)
7. Calculated Aggression - Board-dependent
8. Complete Contract - Challenge-dependent
9. Knowledge from Deep - Territory-dependent
10. Get Away From Me - Position-dependent

### Low Tier (Niche Use)
11. Mountain Purification - Requires heart control
12. Sabotage - Match-dependent
13. Echo of Silence - Team-dependent
14. Betting from Depths - High variance
15. Double Bid - Luck-dependent

---

## 💡 Pro Tips

1. **Save Rift of Knowledge** - Use only when opponent draws game-winning card
2. **Cast Victory Strike Early** - Maximize heart captures after casting
3. **Combo Spells** - Plan multi-spell strategies
4. **Time Pre-Game Spells** - Cast right before crucial matches
5. **Defensive Reserve** - Always keep 1 defensive spell if possible
6. **Information Advantage** - Watch what opponents cast to plan counters
7. **Bluff Potential** - Pretend to have spells you don't
8. **Spell Trading** - If allowed, negotiate with other teams
9. **Risk Assessment** - High risk spells (Betting, Domination) need confidence
10. **Adaptation** - Use "All According to Plan" to copy successful strategies

---

## 🔄 Spell Lifecycle

```
1. DISTRIBUTION
   ↓
2. IN HAND (team can see, plan when to use)
   ↓
3. CAST (spell activated, effect applied)
   ↓
4. ACTIVE (if persistent/permanent type)
   ↓
5. RESOLVED (effect complete)
   ↓
6. USED PILE (available for "All According to Plan")
```

---

## ❓ FAQ

**Q: Can I cast multiple spells per turn?**
A: Yes, as long as timing allows (check spell type)

**Q: Can spells be undone?**
A: Yes, admin can undo any spell via god mode

**Q: What if spell effect unclear?**
A: Admin makes final ruling

**Q: Can I trade spells with other teams?**
A: Not by default, admin can allow if desired

**Q: Do spells persist across rounds?**
A: Permanent buffs do, others resolve per-game

**Q: What if opponent cheats during silence?**
A: Admin enforces penalties (point deduction, etc.)

**Q: Can I stack same spell multiple times?**
A: Yes, if you have multiple copies

**Q: What happens if match draws?**
A: Spell effects based on win conditions don't activate

---

Happy Spell Casting! 🔮
