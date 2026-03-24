# Miyabi Order

Automated breakfast ordering from 早點 Morning (蘆洲碳烤三明治).

## Installation

### macOS

1. Install Node.js (v18+)
   ```bash
   brew install node
   ```

2. Clone and install
   ```bash
   git clone https://github.com/robert0ng/miyabi-order.git
   cd miyabi-order
   npm install
   ```
   `npm install` automatically downloads the Playwright Chromium browser via the `postinstall` script.

### Windows

1. Install Node.js (v18+)
   - Download from https://nodejs.org/ and run the installer
   - Or via winget:
     ```powershell
     winget install OpenJS.NodeJS.LTS
     ```

2. Clone and install
   ```powershell
   git clone https://github.com/robert0ng/miyabi-order.git
   cd miyabi-order
   npm install
   ```

3. If Playwright Chromium fails to install automatically, run manually:
   ```powershell
   npx playwright install chromium
   ```

## Usage

### Auto Order (daily use)

```bash
npm run auto
```

Presents a menu of order presets defined in `orders.json`, then places the selected order for next-day pickup.

Set `DRY_RUN = true` in `auto-order.ts` to test without submitting, or `DRY_RUN = false` to submit for real.

If tomorrow is a weekend, you'll be prompted to confirm before proceeding.

For non-interactive use (e.g. cron or CI):
```bash
SKIP_WEEKEND_CHECK=1 ORDER=0 npm run auto
```

### Configuration (`orders.json`)

All order settings live in `orders.json`:

```json
{
  "store": { "url": "...", "name": "蘆洲碳烤三明治" },
  "customer": { "name": "王", "phone": "0913936203" },
  "pickupTime": "07:00:00",
  "orders": [
    {
      "name": "Daily (火腿蛋吐司 x4)",
      "items": [
        { "item": "招牌火腿蛋吐司", "qty": 3 },
        { "item": "招牌火腿蛋吐司", "qty": 1, "adjustments": ["不加生菜"] }
      ]
    }
  ]
}
```

- **store** — store URL and display name
- **customer** — name and phone for checkout
- **pickupTime** — pickup time (HH:MM:SS)
- **orders** — array of presets, each with a name and items list
- **items** — item name, quantity, and optional adjustments (e.g. 不加生菜)

### Interactive Order

```bash
npm run order
```

Lets you browse the menu, pick items and quantities interactively.

### Site Discovery

```bash
npm run discover
```

Captures screenshots, DOM dumps, and API calls for debugging. Output goes to `screenshots/` and `discovery/`.
