# Breakfast Order

Unified ordering menu for MIYABI 碳烤三明治 and Quickclick stores (添飽寶, 晨食午味).

## Quick Order

When the user says "order", "breakfast", "menu", or "點餐" — **immediately** use the Bash tool to run the following command. Do not ask, do not explain, just run it:

```bash
cd /Users/bowenwang/Dev/breakfast-order && npm run menu
```

The interactive menu handles everything — store selection, preset vs. browse, dry run vs. real order, and saving new presets.
