# Add a New Ordering Store

Guide for integrating a new breakfast store into the unified menu at `/Users/bowenwang/Dev/breakfast-order`.

---

## Step 1 — Identify the platform

Determine which ordering platform the store uses:

| Platform | Clues | Reference |
|----------|-------|-----------|
| **CinPOS** | URL contains `cinpos.com`, Angular app (`ngb-modal-*`) | `miyabi-order/` |
| **Quickclick LINE LIFF** | URL starts with `liff.line.me`, `quickclick.cc` in network requests | `quickclick-order/` |
| **New platform** | Neither of the above | Create a new subdirectory (see Step 5) |

---

## Step 2a — CinPOS store (miyabi-order pattern)

### What we know about CinPOS
- Menu items: `.menu-item` → `.menu-item-content-name` / `.menu-item-content-price`
- Modals to dismiss: `ngb-modal-window, ngb-modal-backdrop`
- Start ordering button: `button:has-text("開始點餐")`
- Add to cart: `button:has-text("新增")`
- Quantity: `app-icon-plus` inside `ngb-modal-window`
- Cart: `button:has-text("前往購物車")` or `/cart?orderType=TO_GO`
- Checkout: `button:has-text("結帳")`
- Pickup time: `select[name="time"]` → `button:has-text("確認時間")`
- Tomorrow tab: `text=明天`
- Name input: `input[type="text"][placeholder="必填"]`
- Phone input: `input[type="tel"]`
- Submit: `button:has-text("立即下單")` → confirm `button:has-text("訂單沒問題")`
- Confirmation: `app-tag-number .tag-number.darkened div` (digits), body text match `/ML\d+/`

### Add to miyabi-order/orders.json
```json
{
  "store": { "url": "<cinpos store url>?orderType=TO_GO", "name": "<display name>" },
  "customer": { "name": "王", "phone": "0913936203" },
  "pickupTime": "07:00:00",
  "orders": [
    {
      "name": "<preset name>",
      "items": [
        { "item": "<exact menu item name>", "qty": 1 },
        { "item": "<item with adjustment>", "qty": 1, "adjustments": ["不加生菜"] }
      ]
    }
  ]
}
```

> Note: Currently miyabi-order supports one store. To add a second CinPOS store, either create a new subdirectory following the same pattern, or extend `orders.json` to support an array of stores and update `auto-order.ts` accordingly.

---

## Step 2b — Quickclick LINE LIFF store (quickclick-order pattern)

### Discovery first
Run the discovery tool to map the store's menu structure and required adjustment fields:

```bash
cd quickclick-order
npx tsx discover.ts --url "<LINE LIFF URL>"
```

This uses Playwright + Claude to autonomously navigate the store, identify required fields (orange `必` badges), detect sub-modals, and report the full item/adjustment schema. It also saves `auth.json` for future reuse.

### Adjustment field types
| Key | Type | Example value |
|-----|------|---------------|
| `category` | Tab nav | `"蛋餅/脆餅"` |
| Any custom key | Radio button | `"脆餅"` (partial match) |
| `餐點需求` | Checkboxes | `"加雙蛋,不加醬"` (comma-separated) |
| `加料` | Sub-modal add-on | `"加蛋"` |

### Add to quickclick-order/orders.json
```json
{
  "stores": {
    "<accountId>": "<Display Name>"
  },
  "orders": [
    {
      "name": "<preset name>",
      "store": "<accountId>",
      "items": [
        {
          "item": "<exact item name>",
          "qty": 1,
          "adjustments": {
            "category": "<tab name>",
            "<field>": "<option>",
            "餐點需求": "<option1>,<option2>"
          }
        }
      ]
    }
  ]
}
```

The `accountId` is the store slug extracted from the LIFF URL (e.g. `addabaobao` from `https://liff.line.me/.../addabaobao`).

### Add display name to stores map
```json
"stores": {
  "addabaobao": "添飽寶",
  "moring-food-lunch-flavor": "晨食午味",
  "<new-account-id>": "<New Store Name>"
}
```

---

## Step 3 — menu.ts integration (new platform only)

If adding a store to an **existing platform** (CinPOS or Quickclick), `menu.ts` picks it up automatically from `orders.json` — no code changes needed.

If adding a **new platform**:

1. Create a new subdirectory `<platform>-order/` with:
   - `orders.json` — store config, customer info, presets
   - `<platform>-order.ts` — Playwright ordering script supporting `--preset <name>` and `--dry-run` flags
   - `package.json` — with `playwright`, `tsx` dependencies

2. In `menu.ts`, add the new platform to `main()`:
   ```typescript
   const platformIdx = await pickOne("Select store:", [
     `MIYABI 碳烤三明治  (${miyabiConfig.orders.length} presets)`,
     "Quickclick ▸",
     "<New Platform> ▸",   // ← add here
   ]);
   ```
   Then handle `platformIdx === 2` with the appropriate store selection and order execution logic (follow the quickclick pattern in `runQcPreset` / `runQcBrowse`).

3. Add `"<platform>-order"` entry to root `package.json` if needed.

---

## Step 4 — Test

```bash
# Dry run through the menu
cd /Users/bowenwang/Dev/breakfast-order
echo "1
1
1
n" | npm run menu

# Or directly test the store script
cd <platform>-order
npx tsx <script>.ts --preset <name> --dry-run
```

---

## Step 5 — Commit

```bash
cd /Users/bowenwang/Dev/breakfast-order
git add .
git commit -m "Add <Store Name> to <platform> ordering"
git push
```
