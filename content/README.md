# Game Content

All game content lives in this directory as simple JSON files. You can add quotes, intro sequences, game over text, and even new moves without touching any JavaScript.

## Adding a Quote

Edit `quotes/engineer.json` or `quotes/contractor.json`. Find the move name and add a string to its array:

```json
{
  "REJECT SUBMITTAL": [
    "...existing quotes...",
    "Your new quote goes here."
  ]
}
```

## Adding an Intro Sequence

Edit `intros.json`. Add a new object to the array:

```json
{
  "name": "Your Intro Name",
  "steps": [
    { "text": "First line appears immediately.", "color": "yellow", "delay": 0 },
    { "text": "Second line after 1.5 seconds.", "color": "white", "delay": 1500 },
    { "text": "Final line.", "color": "bright", "delay": 1200 }
  ]
}
```

Available colors: `yellow`, `white`, `orange`, `red`, `cyan`, `bright`, `muted`, `hpGreen`

The `delay` is milliseconds to wait *after the previous line* before showing this one.

## Adding Game Over Text

Edit `game-over.json`. Add a string to the `engineer` or `contractor` array:

```json
{
  "engineer": ["...existing...", "Your new engineer victory text."],
  "contractor": ["...existing...", "Your new contractor victory text."]
}
```

## Adding a New Move

1. Add the move definition to `moves/engineer.json` or `moves/contractor.json`:

Use literal emoji characters (not escape sequences like `\u{1F4CB}` — those are JS-only).

```json
{
  "name": "MOVE NAME",
  "emoji": "📋",
  "desc": "Short description for button",
  "dmg": [10, 20],
  "mp": 15,
  "effect": null
}
```

2. Add quotes for it in `quotes/engineer.json` or `quotes/contractor.json`:

```json
{
  "MOVE NAME": [
    "Quote one.",
    "Quote two.",
    "At least 3-5 quotes recommended."
  ]
}
```

### Move effect types

| Effect | Description |
|--------|-------------|
| `null` | No special effect, just damage |
| `"stun"` | 30% chance to stun target (skip next turn) |
| `"weaken"` | Target takes 30% more damage next hit |
| `"slow"` | 40% chance to slow target |
| `"defense"` | Caster takes 50% less damage for one hit |
| `"heal"` | Heal 28-45 HP instead of dealing damage (set dmg to [0, 0]) |

## For Claude: Generating Content from the Bible

Read `reference/ktr-vs-engineer-bible.md` for source material, then output JSON matching the schemas above. Focus on:

- Authentic federal construction dialogue and terminology
- Real FAR clause references, UFC citations, and specification language
- The adversarial dynamic between engineer and contractor
- Humor that comes from real industry situations
