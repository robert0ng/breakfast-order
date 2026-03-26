import { chromium, Page } from "playwright";
import { confirm, select } from "@inquirer/prompts";
import * as path from "path";
import * as fs from "fs";

interface OrderItem {
  item: string;
  qty: number;
  adjustments?: string[];
}

interface OrderPreset {
  name: string;
  items: OrderItem[];
}

interface OrderConfig {
  store: { url: string; name: string };
  customer: { name: string; phone: string };
  pickupTime: string;
  orders: OrderPreset[];
}

const CONFIG_PATH = path.join(__dirname, "orders.json");
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
const DRY_RUN = process.env.DRY_RUN !== "0";

function loadConfig(): OrderConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

async function dismissModals(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll("ngb-modal-window, ngb-modal-backdrop")
      .forEach((e) => e.remove());
  });
  await page.waitForTimeout(300);
}

async function addItem(page: Page, itemName: string, qty: number, adjustments: string[]) {
  const itemLocator = page.locator(
    `.menu-item-content-name:has-text("${itemName}")`
  );
  await itemLocator.scrollIntoViewIfNeeded();
  await itemLocator.click();
  await page.waitForTimeout(1500);

  // Apply adjustments (e.g. 不加生菜)
  for (const adj of adjustments) {
    const adjLocator = page.locator(`text=${adj}`);
    if (await adjLocator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await adjLocator.click();
      console.log(`  Checked: ${adj}`);
      await page.waitForTimeout(300);
    } else {
      console.warn(`  WARNING: "${adj}" option not found!`);
    }
  }

  // Increment quantity using "+" button (qty - 1) times
  if (qty > 1) {
    const modal = page.locator("ngb-modal-window");

    let clicked = false;
    for (let i = 0; i < qty - 1; i++) {
      const didClick = await modal.evaluate((m) => {
        const plusIcon = m.querySelector("app-icon-plus");
        const btn = plusIcon?.closest("button");
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (didClick) {
        clicked = true;
        await page.waitForTimeout(300);
      } else {
        break;
      }
    }

    if (clicked) {
      console.log(`  Set quantity to ${qty}`);
    } else {
      console.warn(`  WARNING: "+" button not found! Falling back to adding items individually.`);
      const addBtn = page.locator('button:has-text("新增")').first();
      await addBtn.scrollIntoViewIfNeeded();
      await addBtn.click();
      await page.waitForTimeout(1000);
      for (let i = 1; i < qty; i++) {
        await itemLocator.scrollIntoViewIfNeeded();
        await itemLocator.click();
        await page.waitForTimeout(1500);
        for (const adj of adjustments) {
          const adjLocator = page.locator(`text=${adj}`);
          if (await adjLocator.isVisible({ timeout: 3000 }).catch(() => false)) {
            await adjLocator.click();
            await page.waitForTimeout(300);
          }
        }
        const addBtn2 = page.locator('button:has-text("新增")').first();
        await addBtn2.scrollIntoViewIfNeeded();
        await addBtn2.click();
        await page.waitForTimeout(1000);
      }
      return;
    }
  }

  // Click add to cart
  const addBtn = page.locator('button:has-text("新增")').first();
  await addBtn.scrollIntoViewIfNeeded();
  await addBtn.click();
  await page.waitForTimeout(1000);
}

async function goToCart(page: Page) {
  const cartSelectors = [
    'button:has-text("前往購物車")',
    'button:has-text("購物車")',
  ];

  for (const sel of cartSelectors) {
    const btn = page.locator(sel);
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      return;
    }
  }

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const btn of buttons) {
      const parent = btn.closest(
        "[class*='cart'], [class*='float'], [class*='fixed']"
      );
      if (parent && (parent as HTMLElement).offsetParent !== null) {
        btn.click();
        return true;
      }
    }
    const bottomButtons = buttons
      .filter((b) => b.offsetParent !== null)
      .filter((b) => {
        const rect = b.getBoundingClientRect();
        return rect.y > 800 && /^\d+$/.test(b.innerText.trim());
      });
    if (bottomButtons.length > 0) {
      bottomButtons[0].click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    const currentUrl = page.url();
    const cartUrl =
      currentUrl.split("?")[0] + "/cart?orderType=TO_GO";
    await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
}

async function selectPickupTime(page: Page, pickupTime: string) {
  const bookModalBtn = page.locator('button:has-text("預訂領取時間")');
  if (await bookModalBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await bookModalBtn.click();
    await page.waitForTimeout(2000);
  } else {
    await dismissModals(page);
    await page.waitForTimeout(500);

    const bookOption = page.locator("text=預訂").first();
    if (await bookOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bookOption.click();
      await page.waitForTimeout(2000);
    }
  }

  const tomorrowTab = page.locator("text=明天").first();
  if (await tomorrowTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tomorrowTab.click();
    console.log("  Selected: 明天 (tomorrow)");
    await page.waitForTimeout(1000);
  } else {
    console.log("  WARNING: 明天 tab not found, may default to today");
  }

  const timeSelect = page.locator('select[name="time"]');
  if (await timeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await timeSelect.selectOption(pickupTime);
      console.log(`  Selected pickup time: ${pickupTime}`);
    } catch {
      const firstValue = await timeSelect.evaluate((sel) => {
        const opts = Array.from((sel as HTMLSelectElement).options);
        const valid = opts.find((o) => /\d{2}:\d{2}/.test(o.text));
        return valid?.value || "";
      });
      if (firstValue) {
        await timeSelect.selectOption(firstValue);
        console.log(`  ${pickupTime} not available, selected earliest: ${firstValue}`);
      } else {
        console.log("  No time slots available!");
      }
    }
    await page.waitForTimeout(500);

    const confirmTimeBtn = page.locator('button:has-text("確認時間")');
    if (
      await confirmTimeBtn.isVisible({ timeout: 2000 }).catch(() => false)
    ) {
      await confirmTimeBtn.click();
      await page.waitForTimeout(1000);
    }
  } else {
    console.log("  Time select not found — store may be open for instant orders");
  }
}

async function submitOrder(page: Page) {
  console.log("\n>>> SUBMITTING ORDER...");
  const submitBtn = page.locator('button:has-text("立即下單")');
  if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitBtn.click();
    console.log("  Clicked 立即下單!");
  } else {
    const altSubmit = page.locator('button:has-text("送出訂單")');
    if (await altSubmit.isVisible({ timeout: 3000 }).catch(() => false)) {
      await altSubmit.click();
      console.log("  Clicked 送出訂單!");
    } else {
      const nextBtn = page.locator('button:has-text("下一步")');
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.click();
        console.log("  Clicked 下一步!");
      } else {
        console.error("  ERROR: Could not find submit button!");
        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, "auto-no-submit-btn.png"),
          fullPage: true,
        });
        return false;
      }
    }
  }

  console.log("  Waiting for confirmation dialog...");
  await page.waitForTimeout(2000);
  const confirmOrderBtn = page.locator('button:has-text("訂單沒問題")');
  if (await confirmOrderBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirmOrderBtn.click();
    console.log("  Clicked 訂單沒問題 — order confirmed!");
  } else {
    console.log("  No second confirmation button found, order may have gone through.");
  }

  return true;
}

async function extractConfirmation(page: Page) {
  console.log("Waiting for confirmation page...");
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, "confirmation.png"),
    fullPage: true,
  });
  console.log("  Screenshot saved: screenshots/confirmation.png");

  const pickupDigits = await page.evaluate(() => {
    const tagNumbers = document.querySelectorAll("app-tag-number .tag-number.darkened div");
    return Array.from(tagNumbers).map((el) => el.textContent?.trim() || "");
  });

  const pickupNumber = pickupDigits.join("");

  const pageText = await page.evaluate(() => document.body.innerText);
  const orderMatch = pageText.match(/ML\d+/);
  const orderNumber = orderMatch ? orderMatch[0] : null;

  console.log("\n" + "=".repeat(40));
  if (pickupNumber) {
    console.log(`  PICKUP NUMBER: #${pickupNumber}`);
  }
  if (orderNumber) {
    console.log(`  ORDER NUMBER:  ${orderNumber}`);
  }
  console.log("=".repeat(40));

  console.log(`\nConfirmation URL: ${page.url()}`);
  return { pickupNumber, orderNumber };
}

function formatOrderSummary(preset: OrderPreset): string {
  return preset.items
    .map((i) => {
      const adj = i.adjustments?.length ? ` (${i.adjustments.join(", ")})` : "";
      return `${i.qty}x ${i.item}${adj}`;
    })
    .join(", ");
}

async function main() {
  const config = loadConfig();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayOfWeek = tomorrow.getDay();
  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const tomorrowStr = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()} (週${dayNames[dayOfWeek]})`;

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    if (process.env.SKIP_WEEKEND_CHECK !== "1") {
      const proceed = await confirm({
        message: `Tomorrow is ${tomorrowStr} (weekend). Continue ordering?`,
        default: false,
      });
      if (!proceed) {
        console.log("Order cancelled.");
        return;
      }
    } else {
      console.log(`Note: Tomorrow is ${tomorrowStr} (weekend) — skipping check.`);
    }
  }

  // Present order selection menu (or use ORDER env var to skip)
  let selectedIndex: number;
  const orderEnv = process.env.ORDER;
  if (orderEnv !== undefined) {
    selectedIndex = parseInt(orderEnv, 10);
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= config.orders.length) {
      console.error(`Invalid ORDER=${orderEnv}. Must be 0-${config.orders.length - 1}.`);
      return;
    }
    console.log(`ORDER=${selectedIndex} — using preset: ${config.orders[selectedIndex].name}`);
  } else {
    const choices = config.orders.map((preset, i) => ({
      name: `${preset.name}  —  ${formatOrderSummary(preset)}`,
      value: i,
    }));

    selectedIndex = await select({
      message: `Select order for ${tomorrowStr}:`,
      choices,
    });
  }

  const selectedOrder = config.orders[selectedIndex];

  console.log(`\nOrder: ${selectedOrder.name}`);
  console.log(`  Store: ${config.store.name}`);
  console.log(`  Pickup: ${tomorrowStr} ${config.pickupTime.slice(0, 5)}`);
  console.log(`  Customer: ${config.customer.name} / ${config.customer.phone}`);
  for (const item of selectedOrder.items) {
    const adj = item.adjustments?.length ? ` (${item.adjustments.join(", ")})` : "";
    console.log(`  - ${item.qty}x ${item.item}${adj}`);
  }
  if (DRY_RUN) console.log("  MODE: DRY RUN (will not submit)");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  try {
    // 1. Navigate
    console.log("\nLoading store page...");
    await page.goto(config.store.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    // 2. Dismiss modals
    await dismissModals(page);

    // 3. Click 開始點餐 if visible
    const startBtn = page.locator('button:has-text("開始點餐")');
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(1500);
    }

    // 4. Add items
    for (const orderItem of selectedOrder.items) {
      const adj = orderItem.adjustments?.length ? ` (${orderItem.adjustments.join(", ")})` : "";
      console.log(`\nAdding ${orderItem.qty}x ${orderItem.item}${adj}...`);
      await addItem(page, orderItem.item, orderItem.qty, orderItem.adjustments || []);
    }

    console.log(`\nAll items added.`);

    // 5. Go to cart
    console.log("Going to cart...");
    await goToCart(page);
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "auto-cart.png"),
    });

    // 6. Checkout
    console.log("Proceeding to checkout...");
    const checkoutBtn = page.locator("button").filter({ hasText: "結帳" });
    await checkoutBtn.first().click();
    await page.waitForTimeout(5000);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    // 7. Pickup time
    console.log("Setting pickup time...");
    await selectPickupTime(page, config.pickupTime);
    await dismissModals(page);
    await page.waitForTimeout(500);

    // 8. Fill checkout form
    console.log("Filling checkout form...");

    const nameInput = page
      .locator('input[type="text"][placeholder="必填"]')
      .first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill(config.customer.name);
      console.log(`  Name: ${config.customer.name}`);
    }

    const phoneInput = page.locator('input[type="tel"]');
    if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneInput.fill(config.customer.phone);
      console.log(`  Phone: ${config.customer.phone}`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "auto-checkout.png"),
      fullPage: true,
    });

    // 9. Submit or dry run
    if (DRY_RUN) {
      console.log("\n=== DRY RUN — order NOT submitted ===");
      console.log("Review screenshots/auto-checkout.png to verify.");
      console.log("Set DRY_RUN = false to submit for real.\n");
      await page.waitForTimeout(10000);
    } else {
      const submitted = await submitOrder(page);
      if (submitted) {
        await extractConfirmation(page);
      }
      await page.waitForTimeout(10000);
    }

    console.log("\nDone! Check screenshots/ for visual record.");
  } catch (err) {
    console.error("Error:", (err as Error).message);
    await page
      .screenshot({
        path: path.join(SCREENSHOTS_DIR, "auto-error.png"),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
