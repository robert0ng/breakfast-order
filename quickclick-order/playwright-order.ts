/**
 * playwright-order.ts — Place an order on quickclick.cc via Playwright (hardcoded flow).
 *
 * Usage:
 *   npx tsx playwright-order.ts --url "<liff-url>" [--preset <name>] [--dry-run]
 *
 * No claude -p calls — direct DOM automation. Runs in ~10-15 seconds.
 */

import "dotenv/config";
import { chromium, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const PRESET_NAME = getFlag("--preset");
const DRY_RUN = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface OrderItem {
  item: string;
  qty: number;
  adjustments?: Record<string, string>;
}

interface OrderPreset {
  name: string;
  store?: string;
  items: OrderItem[];
}

interface OrdersConfig {
  customer: { name: string; phone: string };
  pickupTime: string; // "HH:MM:SS"
  orders: OrderPreset[];
}

const ordersPath = path.resolve("orders.json");
if (!fs.existsSync(ordersPath)) {
  console.error("orders.json not found. Run from the quickclick-order directory.");
  process.exit(1);
}
const config: OrdersConfig = JSON.parse(fs.readFileSync(ordersPath, "utf-8"));

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function resolvePresetAndUrl(): Promise<{ preset: OrderPreset; url: string }> {
  // --preset flag: use directly
  if (PRESET_NAME) {
    const p = config.orders.find((o) => o.name === PRESET_NAME);
    if (!p) {
      console.error(`Preset "${PRESET_NAME}" not found. Available: ${config.orders.map((o) => o.name).join(", ")}`);
      process.exit(1);
    }
    return { preset: p, url: resolveUrl(p) };
  }

  // Group presets by store (fall back to preset name if no store field)
  const stores = [...new Set(config.orders.map((o) => o.store ?? o.name))];

  if (stores.length === 1) {
    const p = config.orders[0];
    return { preset: p, url: resolveUrl(p) };
  }

  console.log("\nSelect a store:");
  stores.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  const answer = await ask("Enter number: ");
  const idx = parseInt(answer) - 1;
  if (isNaN(idx) || idx < 0 || idx >= stores.length) {
    console.error("Invalid selection.");
    process.exit(1);
  }

  const store = stores[idx];
  const p = config.orders.find((o) => (o.store ?? o.name) === store)!;
  return { preset: p, url: resolveUrl(p) };
}

function resolveUrl(p: OrderPreset): string {
  const flag = getFlag("--url");
  if (flag) return flag;
  if (p.store) {
    const key = `QUICKCLICK_URL_${p.store.toUpperCase().replace(/-/g, "_")}`;
    if (process.env[key]) return process.env[key]!;
  }
  if (process.env.QUICKCLICK_URL) return process.env.QUICKCLICK_URL;
  console.error("No URL: set QUICKCLICK_URL_<STORE> in .env or pass --url");
  process.exit(1);
}

const SCREENSHOTS_DIR = path.resolve("screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const AUTH_STATE = path.resolve("auth.json");
const LINE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/13.6.1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function shot(page: Page, name: string) {
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${name}`);
}

async function clearCart(page: Page) {
  // Wait for Vue to render the cart badge before reading it
  await page.waitForSelector('a[href="#shopping_cart"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const nbText = await page.locator('a[href="#shopping_cart"] .nb').textContent().catch(() => "0");
  const nb = parseInt(nbText?.trim() || "0");
  if (nb === 0) {
    console.log("  Cart empty.");
    return;
  }
  console.log(`  Clearing ${nb} cart items...`);

  await page.click('a[href="#shopping_cart"]');
  await page.waitForSelector(".modal.shopping_cart", { state: "visible" });

  // Click minus on the first item until it disappears; repeat until list is empty
  while (true) {
    const items = page.locator(".modal.shopping_cart .shopping_car_list li");
    if ((await items.count()) === 0) break;
    const firstItem = items.first();
    const qtyVal = parseInt((await firstItem.locator("input[type=number]").inputValue()) || "1");
    const minusBtn = firstItem.locator(".input_quantity button").first();
    for (let i = 0; i < qtyVal; i++) {
      await minusBtn.click();
      await page.waitForTimeout(300);
    }
  }

  await page.locator(".modal.shopping_cart a.back").click();
  await page.waitForTimeout(400);
  console.log("  Cart cleared.");
}

async function addItem(page: Page, item: OrderItem) {
  const { item: name, qty, adjustments } = item;
  const category = adjustments?.category;
  console.log(`\nAdding: ${name} ×${qty}${category ? ` [${category}]` : ""}`);

  // Navigate to category tab if specified
  if (category) {
    const tab = page.locator("nav p").filter({ hasText: category });
    await tab.first().click();
    await page.waitForTimeout(600);
  }

  // Click the item card — use exact text match to avoid "里肌排" hitting "里肌排蛋"
  const card = page.locator(".product_area li").filter({
    has: page.getByText(name, { exact: true }),
  });
  await card.first().click();

  // Wait for the item modal to open
  await page.waitForSelector(".jquery-modal.current .modal.food_items", { timeout: 6000 });
  await page.waitForTimeout(400);

  const modal = page.locator(".jquery-modal.current .modal.food_items");

  // Apply radio options (e.g. 餅點選擇: 脆餅)
  for (const [key, value] of Object.entries(adjustments || {})) {
    if (key === "category" || key === "餐點需求" || key === "加料") continue;

    const radioLabel = modal.locator(".the_radio label").filter({ hasText: value });
    if ((await radioLabel.count()) > 0) {
      console.log(`  Radio [${key}]: ${value}`);
      await radioLabel.first().click();
      await page.waitForTimeout(400);
      // Some radios trigger an intermediate sub-modal (e.g. 餐點選擇); handle it.
      // Detect by the sub-modal title "餐點選擇" — avoids false-matching the main modal's own 選好了 button.
      const subModalTitle = page.locator(".jquery-modal.current").getByText("餐點選擇", { exact: true });
      const doneBtn = page.locator(".jquery-modal.current a").filter({ hasText: "選好了" });
      if (await subModalTitle.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`  Sub-modal (餐點選擇) appeared`);
        // If a 加料 value is specified, try to select it in the popup
        const addOn = adjustments?.["加料"];
        if (addOn) {
          const addOnItem = page.locator(".jquery-modal.current").getByText(addOn, { exact: false });
          if (await addOnItem.isVisible({ timeout: 500 }).catch(() => false)) {
            console.log(`  Selecting add-on in popup: ${addOn}`);
            await addOnItem.first().click();
            await page.waitForTimeout(300);
          }
        }
        console.log(`  Clicking 選好了`);
        await doneBtn.first().click();
        await page.waitForSelector(".jquery-modal.current .modal.food_items", { timeout: 5000 });
        await page.waitForTimeout(400);
      }
    } else {
      console.warn(`  ⚠ Radio option not found: ${value}`);
    }
  }

  // Apply checkbox options (餐點需求), comma-separated if multiple
  const needs = adjustments?.["餐點需求"];
  if (needs) {
    for (const need of needs.split(",").map((s) => s.trim())) {
      const checkLabel = modal.locator(".the_checkbox label").filter({ hasText: need });
      if ((await checkLabel.count()) > 0) {
        console.log(`  Checkbox [餐點需求]: ${need}`);
        await checkLabel.first().click();
        await page.waitForTimeout(200);
      } else {
        console.warn(`  ⚠ Checkbox option not found: ${need}`);
      }
    }
  }

  // Set quantity — fill directly and dispatch input event for Vue reactivity
  const qtyInput = modal.locator(".input_quantity input[type=number]");
  await qtyInput.fill(String(qty));
  await qtyInput.dispatchEvent("input");
  await qtyInput.dispatchEvent("change");
  await page.waitForTimeout(200);

  // Screenshot modal before submitting
  await shot(page, `modal-${name}`);

  // Confirm and add to cart
  await modal.locator("a.next").click();
  await page.waitForTimeout(500);

  // Check for required-field alert (swal2)
  const swal = page.locator(".swal2-container");
  if (await swal.isVisible({ timeout: 500 }).catch(() => false)) {
    await shot(page, `error-${name}`);
    const msg = await page.locator(".swal2-title, .swal2-html-container, .swal2-content").textContent().catch(() => "unknown");
    await page.keyboard.press("Escape");
    throw new Error(`Required field alert for "${name}": ${msg}`);
  }
  await page.waitForTimeout(300);
  console.log(`  ✓ Added`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { preset, url: TARGET_URL } = await resolvePresetAndUrl();

  const mode = DRY_RUN ? "DRY RUN" : "REAL RUN";
  console.log(`\nquickclick-order (Playwright) — ${mode}`);
  console.log(`Preset: ${preset.name}`);
  console.log(`Items: ${preset.items.map((i) => `${i.item}×${i.qty}`).join(", ")}`);
  console.log(`URL: ${TARGET_URL}\n`);

  if (!DRY_RUN) {
    console.log("⚠️  REAL RUN — order will be submitted. Ctrl+C to abort.");
    await new Promise((r) => setTimeout(r, 3000));
  }

  const browser = await chromium.launch({
    channel: "chrome", // use system Chrome — no download needed
    headless: false,
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(AUTH_STATE) ? AUTH_STATE : undefined,
    userAgent: LINE_UA,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    // 1. Navigate to menu
    console.log("[1] Loading menu...");
    await page.goto(TARGET_URL, { waitUntil: "networkidle" });
    await shot(page, "01-menu");

    // 2. Clear existing cart
    console.log("[2] Clearing cart...");
    await clearCart(page);

    // 3. Add items
    console.log("[3] Adding items...");
    for (const item of preset.items) {
      await addItem(page, item);
    }
    await shot(page, "02-items-added");

    // 4. Go to checkout
    console.log("\n[4] Proceeding to checkout...");
    // Dismiss any SweetAlert2 dialogs that may be blocking
    const swal = page.locator(".swal2-container");
    if (await swal.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log("  Dismissing swal2 dialog...");
      await page.locator(".swal2-confirm, .swal2-cancel, button.swal2-styled").first().click().catch(() => {});
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await page.locator("a.btn.next").filter({ hasText: "確認訂單" }).click();
    await page.waitForURL("**/liff2-order-flow**", { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, "03-step1");

    // 4b. If "Other 其它需求" step appears, click 下一步 to advance
    const clicked4b = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const btn = links.find(el => el.textContent?.trim() === "下一步");
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked4b) {
      console.log("[4b] Advancing past 其它需求 step...");
      await page.waitForTimeout(1000);
    }

    // 5. Select 自取
    console.log("[5] Selecting 自取...");
    await page.waitForSelector("ul.get_way", { state: "visible", timeout: 15000 });
    await page.locator("ul.get_way li").filter({ hasText: "自取" }).click();
    await page.waitForTimeout(600);

    // 6. Set pickup time (if time picker appears)
    const timeChoosed = page.locator(".time_choosed");
    if (await timeChoosed.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`[6] Setting pickup time: ${config.pickupTime}`);
      await timeChoosed.click();
      await page.waitForSelector("#selectDateTime", { state: "visible" });

      // Date: first available option (today)
      await page.locator("#selectDateTime select.fill_in").first().selectOption({ index: 0 });
      await page.waitForTimeout(300);

      // Time: match HH:MM from pickupTime
      const hhmm = config.pickupTime.slice(0, 5); // "07:00"
      const timeSelect = page.locator("#selectDateTime select.fill_in").nth(1);
      const options = await timeSelect.locator("option").all();
      let matched = false;
      for (const opt of options) {
        const text = (await opt.textContent()) ?? "";
        if (text.includes(hhmm)) {
          await timeSelect.selectOption({ label: text.trim() });
          matched = true;
          console.log(`  Time selected: ${text.trim()}`);
          break;
        }
      }
      if (!matched) {
        console.warn(`  ⚠ Time ${hhmm} not in picker — using first option`);
        await timeSelect.selectOption({ index: 0 });
      }

      await page.locator("#selectDateTime a.next").click();
      await page.waitForTimeout(400);
    } else {
      console.log("[6] No time picker (立即取餐)");
    }

    // 7. Click 下一步 (scoped to the visible step-1 main)
    console.log("[7] Clicking 下一步...");
    await page.locator("main#main #nextPage").click();
    await page.waitForTimeout(800);
    await shot(page, "04-step2");

    // 8. Fill order info
    console.log("[8] Filling name & phone...");
    await page.fill("input#name", config.customer.name);
    await page.fill("input#phone", config.customer.phone);
    await shot(page, "05-filled");

    if (DRY_RUN) {
      console.log("\n✅ DRY RUN complete — not submitting.");
      console.log(`Screenshots: ${SCREENSHOTS_DIR}`);
      return;
    }

    // 9. Submit
    console.log("[9] Submitting order...");
    await page.click('a[href="#finish"]');
    await page.waitForSelector("#finish", { state: "visible" });
    await shot(page, "06-confirm-modal");

    // Confirm in the finish modal
    await page.locator("#finish a.next").click();
    await page.waitForTimeout(2000);
    await shot(page, "07-done");

    console.log("\n✅ Order submitted!");
    console.log(`Screenshots: ${SCREENSHOTS_DIR}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
