# quickclick-order

Playwright-based automation for placing catering orders on [quickclick.cc](https://quickclick.cc) via LINE LIFF. Supports dry-run mode, multi-item presets, and multi-store ordering.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [.env](#env)
  - [orders.json](#ordersjson)
- [Usage](#usage)
  - [Dry Run](#dry-run)
  - [Real Order](#real-order)
- [Exploring a New Store](#exploring-a-new-store)
  - [Step 1 — Get the LIFF URL](#step-1--get-the-liff-url)
  - [Step 2 — Run discovery.ts](#step-2--run-discoveryts)
  - [Step 3 — Inspect Screenshots](#step-3--inspect-screenshots)
  - [Step 4 — Add the Store to orders.json](#step-4--add-the-store-to-ordersjson)
  - [Step 5 — Dry Run and Debug](#step-5--dry-run-and-debug)
- [Debugging Playbook](#debugging-playbook)
  - [Required field alert](#required-field-alert)
  - [Multi-step modals](#multi-step-modals)
  - [Hidden checkout elements](#hidden-checkout-elements)
- [File Reference](#file-reference)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | |
| npx / npm | bundled with Node | |
| [Playwright](https://playwright.dev) | auto-installed | Chromium browser |
| [agent-browser](https://github.com/anthropics/agent-browser) | latest | Used by `discover.ts` only |
| [Claude Code CLI](https://github.com/anthropics/claude-code) (`claude`) | latest | Used by `discover.ts` only |

---

## Installation

```bash
git clone https://github.com/robert0ng/quickclick-order.git
cd quickclick-order
npm install
npx playwright install chromium
```

---

## Configuration

### .env

Create a `.env` file in the project root (already gitignored):

```env
QUICKCLICK_EMAIL=your@email.com
QUICKCLICK_PASSWORD=yourpassword
```

These credentials are only required by `discover.ts`. `playwright-order.ts` uses a saved session (`auth.json`), which is generated the first time you run `discover.ts` and log in successfully.

### orders.json

This is the main configuration file for all presets and stores.

```json
{
  "customer": {
    "name": "王",
    "phone": "0913936203"
  },
  "pickupTime": "07:00:00",
  "orders": [
    {
      "name": "eggroll",
      "store": "addabaobao",
      "items": [
        {
          "item": "玉米",
          "qty": 2,
          "adjustments": {
            "category": "蛋餅/脆餅",
            "餅點選擇": "脆餅",
            "餐點需求": "加雙蛋"
          }
        }
      ]
    },
    {
      "name": "morning",
      "store": "moring-food-lunch-flavor",
      "items": [
        {
          "item": "牛肉培根起司",
          "qty": 4,
          "adjustments": {
            "category": "三明治&漢堡",
            "麵包選擇": "吐司",
            "加料": "加蛋"
          }
        }
      ]
    }
  ]
}
```

#### Field Reference

| Field | Description |
|-------|-------------|
| `customer.name` | Name filled into the order form |
| `customer.phone` | Phone filled into the order form |
| `pickupTime` | `HH:MM:SS` — matched against the time picker options |
| `orders[].name` | Preset name shown in the store selection menu |
| `orders[].store` | quickclick.cc store account ID (slug in the LIFF URL) |
| `orders[].items[].item` | Exact menu item name (Chinese) — matched via exact text |
| `orders[].items[].qty` | Quantity |
| `adjustments.category` | Tab/category to click before searching for the item |
| `adjustments.<radio-group>` | Any radio button group key → partial text match (e.g. `"麵包選擇": "吐司"` matches `原味吐司`) |
| `adjustments.餐點需求` | Comma-separated checkbox options (e.g. `"加雙蛋"`) |
| `adjustments.加料` | Add-on selected inside a sub-modal (e.g. `"加蛋"`) — see [Multi-step modals](#multi-step-modals) |

---

## Usage

### Dry Run

Runs through the entire flow — loads menu, adds items, walks through checkout — but stops before submitting the order.

```bash
echo "2" | npx tsx playwright-order.ts --dry-run
```

Or interactively:

```bash
npx tsx playwright-order.ts --dry-run
# Select a store: 1. addabaobao  2. moring-food-lunch-flavor
```

Screenshots are saved to `screenshots/` at each milestone:

| File | When |
|------|------|
| `01-menu.png` | After menu loads |
| `modal-<item>.png` | Item customization modal, before submitting |
| `error-<item>.png` | swal2 required-field alert (if triggered) |
| `02-items-added.png` | After all items added to cart |
| `03-step1.png` | After navigating to checkout |
| `04-step2.png` | After pickup method / time selected |
| `05-filled.png` | Order review with name & phone filled |

### Real Order

```bash
echo "2" | npx tsx playwright-order.ts
```

Waits 3 seconds for abort (Ctrl+C), then submits the order for real.

---

## Exploring a New Store

When you want to add a new quickclick store, follow this discovery process.

### Step 1 — Get the LIFF URL

1. Open LINE and start a chat with the store's quickclick bot.
2. Tap the order button — it opens a LIFF mini-app.
3. Copy the full URL from the browser address bar. It looks like:
   ```
   https://liff.line.me/1655733949-XXXXXXXX?accountId=YYYY&type=catering&source=qc&token=<long-token>
   ```
4. The `accountId` value is the store slug used in `orders.json`.

> **Tip:** The token in the URL is session-specific and expires. Always grab a fresh URL when running discovery.

### Step 2 — Run discover.ts

`discover.ts` uses `agent-browser` (a headless browser CLI) and `claude -p` (Claude Code CLI) to autonomously explore the store's menu, categories, and customization options — without placing an order.

```bash
npx tsx discover.ts --url "https://liff.line.me/..."
```

The agent will:
- Navigate to the LIFF URL
- Log in automatically if a login screen appears (using `.env` credentials)
- Browse each menu category
- Click into individual items to inspect customization options (radio groups, checkboxes)
- Screenshot key milestones into `screenshots/`
- Print a structured discovery report when done

**Example output:**
```
[step 1] Asking Claude...
[step 2] Asking Claude...
...
============================================================
DISCOVERY REPORT:
Categories: 三明治&漢堡, 鍋燒烤片, 菜單系列
Items found:
  - 牛肉培根起司 ($65): 必選 麵包選擇 (紅豆/五穀雜糧/原味吐司), 加料 (加蛋+$15/加歡雞蛋+$30)
  - 山炒飯 ($60): no customization
...
============================================================
```

### Step 3 — Inspect Screenshots

Open `screenshots/` and review what the agent captured. Key things to look for:

- **Required fields (必)** — orange `必` badge on a radio group means the field must be selected or the order will fail with a swal2 alert.
- **Sub-modal triggers** — some radio selections (e.g. bread type) open a secondary "餐點選擇" popup before returning to the item modal. This requires special handling (see [Multi-step modals](#multi-step-modals)).
- **Checkbox vs radio** — checkboxes use `餐點需求` key; radio buttons use any other named key; sub-modal add-ons use `加料` key.

### Step 4 — Add the Store to orders.json

Add a new entry to the `orders` array:

```json
{
  "name": "my-preset-name",
  "store": "store-account-id",
  "items": [
    {
      "item": "菜單上的正確名稱",
      "qty": 2,
      "adjustments": {
        "category": "分類 Tab 名稱",
        "必選欄位": "選項部分文字",
        "餐點需求": "加蛋",
        "加料": "加蛋"
      }
    }
  ]
}
```

**Matching rules:**
- `category` — partial text match against tab names in the top nav
- Radio keys — partial text match (e.g. `"吐司"` matches `"原味吐司"`)
- `餐點需求` — comma-separated, each matched as partial text against `.the_checkbox label`
- `加料` — matched inside the "餐點選擇" sub-modal that appears after a radio click

### Step 5 — Dry Run and Debug

```bash
echo "<store-number>" | npx tsx playwright-order.ts --dry-run
```

Check the screenshots in `screenshots/`. If you see `error-<item>.png`, a required field was missed — open `modal-<item>.png` to see all available options and update `orders.json`.

---

## Debugging Playbook

### Required field alert

**Symptom:** `Error: Required field alert for "<item>": <message>`
**Screenshots to check:** `modal-<item>.png`, `error-<item>.png`

1. Open `modal-<item>.png` — look for any field with an orange `必` badge.
2. Open `error-<item>.png` — the swal2 dialog shows "請選擇必選項目".
3. Add the missing field to `adjustments` in `orders.json` using a partial text value that matches the visible option label.

### Multi-step modals

**Symptom:** Item radio click succeeds, but then quantity fill times out.

Some stores open a secondary "餐點選擇" popup after a radio selection (e.g. bread type triggers an add-on picker). The script handles this automatically by detecting a "選好了" button and dismissing the sub-modal.

To select a specific add-on inside the sub-modal, set `"加料": "<option text>"` in `adjustments`. The script will find the matching item in the popup and click it before dismissing.

```json
"adjustments": {
  "category": "三明治&漢堡",
  "麵包選擇": "吐司",
  "加料": "加蛋"
}
```

### Hidden checkout elements

**Symptom:** `waitForSelector("ul.get_way")` times out — delivery method selector stays hidden.

Some stores have an extra checkout step (e.g. "Other 其它需求" — utensil preferences) before the delivery method screen. The script automatically detects any "下一步" button via JS and advances past it.

If a new intermediate step appears, open `03-step1.png` to identify what's on screen and add the appropriate handler in `playwright-order.ts` around step 4b.

---

## File Reference

| File | Purpose |
|------|---------|
| `playwright-order.ts` | Main ordering script — Playwright DOM automation |
| `discover.ts` | Discovery script — autonomous agent (agent-browser + claude CLI) |
| `orders.json` | All presets, store IDs, items, and adjustments |
| `auth.json` | Saved browser session (gitignored — generated by discover.ts login) |
| `.env` | Quickclick credentials (gitignored) |
| `screenshots/` | Debug screenshots from each run (gitignored) |
