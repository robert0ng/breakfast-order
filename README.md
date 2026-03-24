# 🍳 Breakfast Order

Automated breakfast ordering for three stores, with a unified menu accessible from Claude Code on Android.

## Stores

| Store | Platform | Presets |
|-------|----------|---------|
| MIYABI 碳烤三明治 | CinPOS (miyabi-order/) | Daily, Light, French Toast Mix, Choco Mix |
| 添飽寶 | Quickclick LINE LIFF (quickclick-order/) | eggroll |
| 晨食午味 | Quickclick LINE LIFF (quickclick-order/) | morning, random |

---

## Setup

```bash
# Install root dependencies (menu.ts)
npm install

# Install store dependencies
cd miyabi-order && npm install && cd ..
cd quickclick-order && npm install && cd ..
```

---

## Usage

### Unified Menu

```bash
npm run menu
```

The menu uses plain numbered prompts — no arrow keys needed, works anywhere.

```
=== Breakfast Order Menu ===

Select store:
  1. MIYABI 碳烤三明治  (4 presets)
  2. Quickclick ▸
Enter number (1-2): 2

Select store:
  1. 添飽寶  (1 preset)
  2. 晨食午味  (2 presets)
Enter number (1-2): 1

What would you like to do?
  1. Use a preset order
  2. Browse / custom order
Enter number (1-2): 1

Select preset:
  1. eggroll  —  2x 玉米, 2x 里肌排
Enter number (1-1): 1

Submit for real? [y/N]: y
```

---

### Android via Claude Code Remote Control

**On your Mac** — start a named remote session (keep this running):

```bash
claude remote-control --name "breakfast-order"
```

**On Android** — open Claude Code and connect to the `breakfast-order` session.

Type:

```
menu
```

A hook intercepts the message and Claude automatically runs `npm run menu`. Respond to the numbered prompts to select your store, pick a preset or browse items, and confirm the order.

---

## Presets

Presets are stored in each store's `orders.json`.

- **Use a preset** — select it from the menu, confirm dry run or real order
- **Browse / custom order** — pick items manually; after a successful order, you're offered to save the combination as a new preset
- **Edit directly** — modify `miyabi-order/orders.json` or `quickclick-order/orders.json`

---

## Project Structure

```
breakfast-order/
├── menu.ts                    # Unified menu entry point (npm run menu)
├── package.json
├── CLAUDE.md                  # Claude Code instructions (triggers menu on "menu")
│
├── miyabi-order/              # MIYABI 碳烤三明治 (CinPOS web ordering)
│   ├── auto-order.ts          # Automated preset ordering (Playwright)
│   ├── order.ts               # Interactive browse ordering
│   ├── orders.json            # Store config, customer info, presets
│   ├── discover.ts            # Site discovery / debugging tool
│   └── CLAUDE.md
│
└── quickclick-order/          # 添飽寶 & 晨食午味 (Quickclick LINE LIFF)
    ├── playwright-order.ts    # Automated ordering (Playwright)
    ├── orders.json            # Store configs, customer info, presets
    ├── discover.ts            # AI-assisted store discovery (requires auth.json)
    └── browse-menu.ts         # Screenshot menu categories
```

---

## Individual Scripts

### MIYABI 碳烤三明治

```bash
cd miyabi-order

# Run a preset non-interactively (ORDER=index, 0-based)
ORDER=0 DRY_RUN=0 npm run auto

# Interactive preset selection
npm run auto

# Browse live menu and order interactively
npm run order

# Discover store structure / debug
npm run discover
```

### Quickclick (添飽寶 / 晨食午味)

```bash
cd quickclick-order

# Run a named preset
npx tsx playwright-order.ts --preset eggroll

# Dry run (no submission)
npx tsx playwright-order.ts --preset morning --dry-run

# Discover a new store (saves auth.json)
npx tsx discover.ts --url "<LINE LIFF URL>"
```

---

## Order Config

Customer info and pickup time are set in each store's `orders.json`:

```json
{
  "customer": { "name": "王", "phone": "09xxxxxxxx" },
  "pickupTime": "07:00:00"
}
```

All orders are placed for **tomorrow** at the configured pickup time.
