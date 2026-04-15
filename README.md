# Spec Battle RPG

A turn-based RPG where a federal construction **Engineer** battles a **Contractor** using specification language, contract clauses, and bureaucratic warfare.

Set in the world of federal construction, the humor comes from real adversarial dynamics — rejected submittals, weaponized RFIs, invoked SHALL clauses, and claims of Differing Site Conditions.

## Prerequisites

You need **Node.js** (version 22 or newer) installed on your computer. Node.js includes **npm**, the package manager used to install dependencies and run the app.

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** (Long Term Support) version for your operating system — any current LTS is v22+
3. Run the installer and follow the prompts (default settings are fine)
4. Verify the installation by opening a terminal and running:
   ```bash
   node --version
   npm --version
   ```
   The Node version should be `v22.x.x` or higher. Older versions (v18, v20) will fail on JSON import attributes.

## Install & Run

Open a terminal, navigate to the project folder, and run:

```bash
npm install
npm run dev
```

The first command downloads the project's dependencies. The second starts a local development server. Open the URL shown in the terminal (typically [http://localhost:5173](http://localhost:5173)) in your web browser.

## Contributing Content

All game content lives in the `content/` directory as simple JSON files. You can add quotes, intro sequences, moves, and game over text without touching any JavaScript. See [`content/README.md`](content/README.md) for full schemas.

### Add a battle quote

Edit `content/quotes/engineer.json` or `content/quotes/contractor.json`. Each move has a set of named buckets — pick the one that fits your quote and add a string:

```json
{
  "REJECT SUBMITTAL": {
    "default": [
      "...existing fallback quotes — used when nothing more specific fires...",
      "Your new quote goes here."
    ],
    "opening": [
      "...quotes used on the very first move of the match..."
    ],
    "vs_SUBMIT_RFI": [
      "...quotes used when the opponent's previous move was SUBMIT RFI..."
    ]
  }
}
```

The runtime picks a bucket by priority: `opening` (first move of the game) > `vs_<OPPONENT_MOVE>` (specific counter) > `default` (fallback). The `default` bucket is required; the others are optional. See [`content/README.md`](content/README.md) for the full schema and the list of canonical counter pairings.

### Add an intro sequence

Edit `content/intros.json`. Add a new object to the array:

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

### Add game over text

Edit `content/game-over.json`. Add a string to the `engineer` or `contractor` array.

### Add a new move

1. Add the move definition to `content/moves/engineer.json` or `content/moves/contractor.json`
2. Add quotes for it in the matching `content/quotes/` file

### Validate your changes

Run the test suite to make sure your content is well-formed:

```bash
npm test
```

The content integrity tests check for required fields, valid effect types, minimum quote counts, and duplicate detection.

## Build for Production

To create an optimized build for deployment:

```bash
npm run build
npm run preview
```
