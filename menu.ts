/**
 * menu.ts — Unified breakfast order menu for Claude Code (TTY-free).
 *
 * Usage: npm run menu
 *
 * All prompts use plain numbered text — works in Claude Code's Bash tool,
 * remote-control sessions, and any non-TTY environment.
 */

import { chromium, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { spawnSync } from "child_process";

// ─── Paths ────────────────────────────────────────────────────────────────────

const MIYABI_DIR = path.join(__dirname, "miyabi-order");
const QUICKCLICK_DIR = path.join(__dirname, "quickclick-order");

// ─── Types ────────────────────────────────────────────────────────────────────

interface MiyabiItem { item: string; qty: number; adjustments?: string[] }
interface MiyabiPreset { name: string; items: MiyabiItem[] }
interface MiyabiConfig {
  store: { url: string; name: string };
  customer: { name: string; phone: string };
  pickupTime: string;
  orders: MiyabiPreset[];
}

interface QcItem { item: string; qty: number; adjustments?: Record<string, string> }
interface QcPreset { name: string; store?: string; items: QcItem[] }
interface QcConfig {
  stores?: Record<string, string>;
  customer: { name: string; phone: string };
  pickupTime: string;
  orders: QcPreset[];
}

// ─── Config I/O ───────────────────────────────────────────────────────────────

function loadMiyabi(): MiyabiConfig {
  return JSON.parse(fs.readFileSync(path.join(MIYABI_DIR, "orders.json"), "utf-8"));
}

function saveMiyabi(config: MiyabiConfig): void {
  fs.writeFileSync(path.join(MIYABI_DIR, "orders.json"), JSON.stringify(config, null, 2) + "\n");
}

function loadQc(): QcConfig {
  return JSON.parse(fs.readFileSync(path.join(QUICKCLICK_DIR, "orders.json"), "utf-8"));
}

function saveQc(config: QcConfig): void {
  fs.writeFileSync(path.join(QUICKCLICK_DIR, "orders.json"), JSON.stringify(config, null, 2) + "\n");
}

// ─── Plain-text prompt helpers ────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function pickOne(prompt: string, choices: string[]): Promise<number> {
  console.log(`\n${prompt}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  while (true) {
    const ans = await ask(`Enter number (1-${choices.length}): `);
    const n = parseInt(ans, 10);
    if (n >= 1 && n <= choices.length) return n - 1;
    console.log(`  Invalid — enter a number between 1 and ${choices.length}`);
  }
}

async function pickMany(prompt: string, choices: string[]): Promise<number[]> {
  console.log(`\n${prompt}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  while (true) {
    const ans = await ask(`Enter numbers separated by commas (e.g. 1,3): `);
    const nums = ans.split(",").map((s) => parseInt(s.trim(), 10));
    if (nums.every((n) => n >= 1 && n <= choices.length)) return nums.map((n) => n - 1);
    console.log(`  Invalid — use numbers between 1 and ${choices.length}`);
  }
}

async function askText(prompt: string, defaultVal = ""): Promise<string> {
  const hint = defaultVal ? ` [${defaultVal}]` : "";
  const ans = await ask(`${prompt}${hint}: `);
  return ans || defaultVal;
}

async function askYesNo(prompt: string, defaultVal = false): Promise<boolean> {
  const hint = defaultVal ? "[Y/n]" : "[y/N]";
  const ans = await ask(`${prompt} ${hint}: `);
  if (!ans) return defaultVal;
  return ans.toLowerCase().startsWith("y");
}

// ─── Playwright helpers (miyabi) ──────────────────────────────────────────────

async function dismissModals(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("ngb-modal-window, ngb-modal-backdrop").forEach((e) => e.remove());
  });
  await page.waitForTimeout(300);
}

interface MenuItem { name: string; price: number }

async function scrapeMenu(page: Page): Promise<MenuItem[]> {
  return page.evaluate(() => {
    const items: { name: string; price: number }[] = [];
    document.querySelectorAll(".menu-item").forEach((el) => {
      const nameEl = el.querySelector(".menu-item-content-name");
      const priceEl = el.querySelector(".menu-item-content-price");
      if (nameEl && priceEl) {
        const name = (nameEl as HTMLElement).innerText.trim();
        const price = parseInt((priceEl as HTMLElement).innerText.replace(/[^0-9]/g, ""), 10);
        if (name && !isNaN(price)) items.push({ name, price });
      }
    });
    return items;
  });
}

async function addMiyabiItem(page: Page, itemName: string, qty: number, adjustments: string[]) {
  const loc = page.locator(`.menu-item-content-name:has-text("${itemName}")`);
  await loc.scrollIntoViewIfNeeded();
  await loc.click();
  await page.waitForTimeout(1500);

  for (const adj of adjustments) {
    const adjLoc = page.locator(`text=${adj}`);
    if (await adjLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await adjLoc.click();
      await page.waitForTimeout(300);
    } else {
      console.warn(`  WARNING: "${adj}" option not found`);
    }
  }

  if (qty > 1) {
    const modal = page.locator("ngb-modal-window");
    for (let i = 0; i < qty - 1; i++) {
      const clicked = await modal.evaluate((m) => {
        const btn = m.querySelector("app-icon-plus")?.closest("button");
        if (btn) { (btn as HTMLElement).click(); return true; }
        return false;
      });
      if (!clicked) break;
      await page.waitForTimeout(300);
    }
  }

  await page.locator('button:has-text("新增")').first().click();
  await page.waitForTimeout(1000);
}

async function miyabiGoToCart(page: Page) {
  for (const sel of ['button:has-text("前往購物車")', 'button:has-text("購物車")']) {
    const btn = page.locator(sel);
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      return;
    }
  }
  const currentUrl = page.url();
  await page.goto(currentUrl.split("?")[0] + "/cart?orderType=TO_GO", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
}

async function miyabiSelectPickupTime(page: Page, pickupTime: string) {
  const bookBtn = page.locator('button:has-text("預訂領取時間")');
  if (await bookBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await bookBtn.click();
    await page.waitForTimeout(2000);
  } else {
    await dismissModals(page);
    await page.waitForTimeout(500);
    const bookOpt = page.locator("text=預訂").first();
    if (await bookOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bookOpt.click();
      await page.waitForTimeout(2000);
    }
  }
  const tomorrowTab = page.locator("text=明天").first();
  if (await tomorrowTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tomorrowTab.click();
    await page.waitForTimeout(1000);
  }
  const timeSelect = page.locator('select[name="time"]');
  if (await timeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await timeSelect.selectOption(pickupTime).catch(async () => {
      const firstVal = await timeSelect.evaluate((sel) => {
        const opts = Array.from((sel as HTMLSelectElement).options);
        return opts.find((o) => /\d{2}:\d{2}/.test(o.text))?.value || "";
      });
      if (firstVal) await timeSelect.selectOption(firstVal);
    });
    await page.waitForTimeout(500);
    const confirmBtn = page.locator('button:has-text("確認時間")');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
    }
  }
}

async function miyabiCheckout(page: Page, config: MiyabiConfig, dryRun: boolean): Promise<boolean> {
  const screenshotsDir = path.join(MIYABI_DIR, "screenshots");
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

  await miyabiGoToCart(page);
  await page.waitForTimeout(2000);

  const checkoutBtn = page.locator("button").filter({ hasText: "結帳" });
  await checkoutBtn.first().click();
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  await miyabiSelectPickupTime(page, config.pickupTime);
  await dismissModals(page);
  await page.waitForTimeout(500);

  const nameInput = page.locator('input[type="text"][placeholder="必填"]').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) await nameInput.fill(config.customer.name);
  const phoneInput = page.locator('input[type="tel"]');
  if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) await phoneInput.fill(config.customer.phone);

  await page.screenshot({ path: path.join(screenshotsDir, "menu-checkout.png"), fullPage: true });

  if (dryRun) {
    console.log("\n=== DRY RUN — order NOT submitted ===");
    console.log("Review miyabi-order/screenshots/menu-checkout.png to verify.");
    await page.waitForTimeout(3000);
    return false;
  }

  const submitBtn = page.locator('button:has-text("立即下單")');
  if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitBtn.click();
  } else {
    const altBtn = page.locator('button:has-text("送出訂單")');
    if (await altBtn.isVisible({ timeout: 3000 }).catch(() => false)) await altBtn.click();
    else { console.error("Submit button not found!"); return false; }
  }

  await page.waitForTimeout(2000);
  const confirmOrderBtn = page.locator('button:has-text("訂單沒問題")');
  if (await confirmOrderBtn.isVisible({ timeout: 5000 }).catch(() => false)) await confirmOrderBtn.click();

  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: path.join(screenshotsDir, "menu-confirmation.png"), fullPage: true });

  const digits = await page.evaluate(() =>
    Array.from(document.querySelectorAll("app-tag-number .tag-number.darkened div"))
      .map((el) => el.textContent?.trim() || "")
  );
  const pickupNum = digits.join("");
  const bodyText = await page.evaluate(() => document.body.innerText);
  const orderMatch = bodyText.match(/ML\d+/);

  console.log("\n" + "=".repeat(40));
  if (pickupNum) console.log(`  PICKUP NUMBER: #${pickupNum}`);
  if (orderMatch) console.log(`  ORDER NUMBER:  ${orderMatch[0]}`);
  console.log("=".repeat(40));
  return true;
}

// ─── Preset matching ──────────────────────────────────────────────────────────

function miyabiPresetsMatch(a: MiyabiItem[], b: MiyabiItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ai, i) =>
    ai.item === b[i].item &&
    ai.qty === b[i].qty &&
    JSON.stringify(ai.adjustments ?? []) === JSON.stringify(b[i].adjustments ?? [])
  );
}

// ─── Save preset helpers ──────────────────────────────────────────────────────

async function offerSaveMiyabiPreset(items: MiyabiItem[]) {
  const config = loadMiyabi();
  if (config.orders.some((p) => miyabiPresetsMatch(p.items, items))) return;
  if (!await askYesNo("Save this order as a new preset?", true)) return;
  const name = await askText("Preset name");
  if (!name) return;
  config.orders.push({ name, items });
  saveMiyabi(config);
  console.log(`  Preset "${name}" saved!`);
}

async function offerSaveQcPreset(storeId: string, items: QcItem[]) {
  const config = loadQc();
  const serialized = JSON.stringify(items);
  if (config.orders.some((p) => p.store === storeId && JSON.stringify(p.items) === serialized)) return;
  if (!await askYesNo("Save this order as a new preset?", true)) return;
  const name = await askText("Preset name");
  if (!name) return;
  config.orders.push({ name, store: storeId, items });
  saveQc(config);
  console.log(`  Preset "${name}" saved!`);
}

// ─── Miyabi: preset order ─────────────────────────────────────────────────────

function runMiyabiPreset(presetIndex: number, dryRun: boolean) {
  const result = spawnSync("npx", ["tsx", "auto-order.ts"], {
    cwd: MIYABI_DIR,
    stdio: "inherit",
    env: { ...process.env, ORDER: String(presetIndex), DRY_RUN: dryRun ? "1" : "0" },
  });
  if (result.error) console.error("Failed:", result.error.message);
}

// ─── Miyabi: browse order ─────────────────────────────────────────────────────

async function runMiyabiBrowse() {
  const config = loadMiyabi();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, locale: "zh-TW" });
  const page = await context.newPage();

  try {
    console.log("\nLoading store page...");
    await page.goto(config.store.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await dismissModals(page);

    const startBtn = page.locator('button:has-text("開始點餐")');
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(1500);
    }

    const menuItems = await scrapeMenu(page);
    if (menuItems.length === 0) { console.error("No menu items found!"); return; }

    const indices = await pickMany(
      "Available items:",
      menuItems.map((m) => `${m.name}  $${m.price}`)
    );

    const orderedItems: MiyabiItem[] = [];
    for (const i of indices) {
      const m = menuItems[i];
      const qtyStr = await askText(`Qty for ${m.name}`, "1");
      const qty = parseInt(qtyStr, 10) || 1;
      const adjStr = await askText(`Adjustments for ${m.name} (comma-separated, or Enter to skip)`, "");
      const adjustments = adjStr ? adjStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
      orderedItems.push({ item: m.name, qty, ...(adjustments.length ? { adjustments } : {}) });
    }

    console.log("\n=== Order Summary ===");
    for (const oi of orderedItems) {
      const adj = oi.adjustments?.length ? ` (${oi.adjustments.join(", ")})` : "";
      console.log(`  ${oi.qty}x ${oi.item}${adj}`);
    }

    const dryRun = !await askYesNo("Submit this order for real?", false);

    for (const oi of orderedItems) {
      console.log(`\nAdding ${oi.qty}x ${oi.item}...`);
      await addMiyabiItem(page, oi.item, oi.qty, oi.adjustments ?? []);
    }

    const submitted = await miyabiCheckout(page, config, dryRun);
    if (submitted) {
      await page.waitForTimeout(3000);
      await offerSaveMiyabiPreset(orderedItems);
    }
  } catch (err) {
    console.error("Error:", (err as Error).message);
    const screenshotsDir = path.join(MIYABI_DIR, "screenshots");
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
    await page.screenshot({ path: path.join(screenshotsDir, "menu-error.png"), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
    rl.close();
  }
}

// ─── Quickclick: preset order ─────────────────────────────────────────────────

function runQcPreset(presetName: string, dryRun: boolean) {
  const args = ["tsx", "playwright-order.ts", "--preset", presetName];
  if (dryRun) args.push("--dry-run");
  const result = spawnSync("npx", args, { cwd: QUICKCLICK_DIR, stdio: "inherit" });
  if (result.error) console.error("Failed:", result.error.message);
}

// ─── Quickclick: browse order ─────────────────────────────────────────────────

async function runQcBrowse(storeId: string) {
  const config = loadQc();
  const knownItemsMap = new Map<string, QcItem>();
  for (const preset of config.orders.filter((p) => p.store === storeId)) {
    for (const item of preset.items) {
      if (!knownItemsMap.has(item.item)) knownItemsMap.set(item.item, item);
    }
  }
  const knownItems = Array.from(knownItemsMap.values());

  if (knownItems.length === 0) {
    console.log("\nNo known items for this store yet. Run discover.ts first.");
    return;
  }

  const indices = await pickMany("Select items to order:", knownItems.map((i) => i.item));

  const orderedItems: QcItem[] = [];
  for (const i of indices) {
    const template = knownItems[i];
    const qtyStr = await askText(`Qty for ${template.item}`, "1");
    const qty = parseInt(qtyStr, 10) || 1;
    orderedItems.push({ item: template.item, qty, adjustments: template.adjustments });
  }

  console.log("\n=== Order Summary ===");
  for (const oi of orderedItems) {
    const adjStr = oi.adjustments
      ? Object.entries(oi.adjustments).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "";
    console.log(`  ${oi.qty}x ${oi.item}${adjStr ? `  (${adjStr})` : ""}`);
  }

  const dryRun = !await askYesNo("Submit this order for real?", false);

  const TEMP_NAME = "__menu_temp__";
  const tempConfig = loadQc();
  tempConfig.orders = tempConfig.orders.filter((p) => p.name !== TEMP_NAME);
  tempConfig.orders.push({ name: TEMP_NAME, store: storeId, items: orderedItems });
  saveQc(tempConfig);

  try {
    const args = ["tsx", "playwright-order.ts", "--preset", TEMP_NAME];
    if (dryRun) args.push("--dry-run");
    const result = spawnSync("npx", args, { cwd: QUICKCLICK_DIR, stdio: "inherit" });
    if (result.error) console.error("Failed:", result.error.message);
  } finally {
    const cleanConfig = loadQc();
    cleanConfig.orders = cleanConfig.orders.filter((p) => p.name !== TEMP_NAME);
    saveQc(cleanConfig);
  }

  if (!dryRun) await offerSaveQcPreset(storeId, orderedItems);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Breakfast Order Menu ===\n");

  const miyabiConfig = loadMiyabi();
  const qcConfig = loadQc();
  const qcStoreNames = qcConfig.stores ?? {};
  const qcStoreIds = [...new Set(qcConfig.orders.map((o) => o.store).filter(Boolean) as string[])];

  // 1. Select store
  const platformIdx = await pickOne("Select store:", [
    `MIYABI 碳烤三明治  (${miyabiConfig.orders.length} presets)`,
    "Quickclick ▸",
  ]);

  let storeId: string | null = null;
  if (platformIdx === 1) {
    const qcIdx = await pickOne(
      "Select store:",
      qcStoreIds.map((id) => `${qcStoreNames[id] ?? id}  (${qcConfig.orders.filter((p) => p.store === id).length} presets)`)
    );
    storeId = qcStoreIds[qcIdx];
  }

  const isMiyabi = platformIdx === 0;

  // 2. Select action
  const actionIdx = await pickOne("What would you like to do?", [
    "Use a preset order",
    "Browse / custom order",
  ]);

  // 3. Execute
  if (actionIdx === 0) {
    // Preset
    if (isMiyabi) {
      const presetIdx = await pickOne(
        "Select preset:",
        miyabiConfig.orders.map((p) => `${p.name}  —  ${p.items.map((it) => `${it.qty}x ${it.item}`).join(", ")}`)
      );
      const dryRun = !await askYesNo("Submit for real?", false);
      rl.close();
      runMiyabiPreset(presetIdx, dryRun);
    } else {
      const storePresets = qcConfig.orders.filter((p) => p.store === storeId);
      if (storePresets.length === 0) { console.log("No presets for this store yet."); rl.close(); return; }
      const presetIdx = await pickOne(
        "Select preset:",
        storePresets.map((p) => `${p.name}  —  ${p.items.map((it) => `${it.qty}x ${it.item}`).join(", ")}`)
      );
      const dryRun = !await askYesNo("Submit for real?", false);
      rl.close();
      runQcPreset(storePresets[presetIdx].name, dryRun);
    }
  } else {
    // Browse
    if (isMiyabi) {
      await runMiyabiBrowse();
    } else {
      await runQcBrowse(storeId!);
      rl.close();
    }
  }
}

main().catch((err) => { console.error(err); rl.close(); process.exit(1); });
