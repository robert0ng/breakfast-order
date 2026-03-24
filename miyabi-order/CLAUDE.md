# Miyabi Order

Automated breakfast ordering from 早點 Morning (蘆洲碳烤三明治).

## Quick Order

When the user says "order", "breakfast", "menu", or "點餐" — **immediately** use the Bash tool to run the following command. Do not ask, do not explain, just run it:

```bash
cd /Users/bowenwang/Dev/breakfast-order && npm run menu
```

The menu shows all stores (MIYABI + Quickclick), lets you pick a preset or browse items, and saves new orders as presets automatically.

### Manual Commands

- **Show config**: Read `orders.json` for order presets, customer info, and pickup time
- **Change order**: Edit `orders.json` — add/remove/modify order presets
- **Screenshots**: Read the latest png files from `screenshots/` directory
- **Direct preset run**: `ORDER=0 DRY_RUN=0 npm run auto` (0 = first preset, DRY_RUN=0 for real)

## Project Structure

- `auto-order.ts` — fully automatic ordering script (daily use)
- `orders.json` — order presets, customer info, store URL, pickup time
- `order.ts` — interactive ordering script
- `discover.ts` — site discovery/debugging tool
- `screenshots/` — screenshots from each run

## Key Defaults (in orders.json)

- Store: 蘆洲碳烤三明治
- Pickup: 07:00 AM next day (明天)
- Customer: 王 / 0913936203
- Cash payment (現金付款), takeout (外帶)
- Weekend orders require user confirmation
- Multiple order presets selectable at runtime

## Workflow

- Always commit changes after discussion and verification — don't wait for the user to ask.
