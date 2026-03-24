import { chromium, Page } from "playwright";
import { confirm } from "@inquirer/prompts";
import * as path from "path";
import * as fs from "fs";

const STORE_URL =
  "https://morning-web.cinpos.com/store/72a8ab38334095e37ff99f168a0484fb?orderType=TO_GO";
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
const DISCOVERY_DIR = path.join(__dirname, "discovery");
const PHONE_NUMBER = "0913936203";
const NAME = "王";
const PICKUP_TIME = "07:00:00";

// Items for this real order
const SKIP_CONFIRM = process.env.SKIP_CONFIRM === "1";

const ITEMS = [
  { name: "楓糖法國吐司", qty: 2 },
  { name: "草莓法國吐司", qty: 2 },
];

async function dismissModals(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll("ngb-modal-window, ngb-modal-backdrop")
      .forEach((e) => e.remove());
  });
  await page.waitForTimeout(300);
}

async function addSimpleItem(page: Page, itemName: string) {
  const itemLocator = page.locator(
    `.menu-item-content-name:has-text("${itemName}")`
  );
  await itemLocator.scrollIntoViewIfNeeded();
  await itemLocator.click();
  await page.waitForTimeout(1500);

  // Click add to cart (no customizations)
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

  // Fallback: direct navigation
  const currentUrl = page.url();
  const cartUrl = currentUrl.split("?")[0] + "/cart?orderType=TO_GO";
  await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
}

async function selectPickupTime(page: Page) {
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

  // Click "明天" tab
  const tomorrowTab = page.locator("text=明天").first();
  if (await tomorrowTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tomorrowTab.click();
    console.log("  Selected: 明天 (tomorrow)");
    await page.waitForTimeout(1000);
  } else {
    console.log("  WARNING: 明天 tab not found, may default to today");
  }

  // Select time
  const timeSelect = page.locator('select[name="time"]');
  if (await timeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await timeSelect.selectOption(PICKUP_TIME);
      console.log(`  Selected pickup time: ${PICKUP_TIME}`);
    } catch {
      const firstValue = await timeSelect.evaluate((sel) => {
        const opts = Array.from((sel as HTMLSelectElement).options);
        const valid = opts.find((o) => /\d{2}:\d{2}/.test(o.text));
        return valid?.value || "";
      });
      if (firstValue) {
        await timeSelect.selectOption(firstValue);
        console.log(`  07:00 not available, selected earliest: ${firstValue}`);
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
  }
}

async function main() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayOfWeek = tomorrow.getDay();
  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const tomorrowStr = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()} (週${dayNames[dayOfWeek]})`;

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    if (!SKIP_CONFIRM) {
      const proceed = await confirm({
        message: `Tomorrow is ${tomorrowStr} (weekend). Continue ordering?`,
        default: false,
      });
      if (!proceed) {
        console.log("Order cancelled.");
        return;
      }
    } else {
      console.log(`Note: Tomorrow is ${tomorrowStr} (weekend) — proceeding anyway.`);
    }
  }

  const itemSummary = ITEMS.map((i) => `${i.qty}x ${i.name}`).join(", ");
  console.log(`\n🛒 REAL ORDER: ${itemSummary}`);
  console.log(`   Pickup: ${tomorrowStr} 07:00 AM`);
  console.log(`   Name: ${NAME}, Phone: ${PHONE_NUMBER}\n`);

  if (!SKIP_CONFIRM) {
    const proceed = await confirm({
      message: "Submit this REAL order?",
      default: false,
    });
    if (!proceed) {
      console.log("Order cancelled.");
      return;
    }
  } else {
    console.log("SKIP_CONFIRM=1 — submitting order without confirmation.");
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  try {
    // 1. Navigate
    console.log("Loading store page...");
    await page.goto(STORE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    // 2. Dismiss modals
    await dismissModals(page);

    // 3. Click 開始點餐 if visible
    const startBtn = page.locator('button:has-text("開始點餐")');
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dismissModals(page);
      await startBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }

    // 4. Add items
    for (const item of ITEMS) {
      console.log(`\nAdding ${item.qty}x ${item.name}...`);
      for (let i = 0; i < item.qty; i++) {
        console.log(`  Adding item ${i + 1}/${item.qty}...`);
        await addSimpleItem(page, item.name);
      }
    }

    console.log(`\nAll items added.`);

    // 5. Go to cart
    console.log("Going to cart...");
    await goToCart(page);
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "real-cart.png"),
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
    await selectPickupTime(page);
    await dismissModals(page);
    await page.waitForTimeout(500);

    // 8. Fill checkout form
    console.log("Filling checkout form...");

    const nameInput = page
      .locator('input[type="text"][placeholder="必填"]')
      .first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill(NAME);
      console.log(`  Name: ${NAME}`);
    }

    const phoneInput = page.locator('input[type="tel"]');
    if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneInput.fill(PHONE_NUMBER);
      console.log(`  Phone: ${PHONE_NUMBER}`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "real-checkout.png"),
      fullPage: true,
    });

    // 9. SUBMIT THE ORDER
    console.log("\n>>> SUBMITTING ORDER...");
    const submitBtn = page.locator('button:has-text("立即下單")');
    if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await submitBtn.click();
      console.log("  Clicked 立即下單!");
    } else {
      // Try alternative submit button text
      const altSubmit = page.locator('button:has-text("送出訂單")');
      if (await altSubmit.isVisible({ timeout: 3000 }).catch(() => false)) {
        await altSubmit.click();
        console.log("  Clicked 送出訂單!");
      } else {
        console.error("  ERROR: Could not find submit button!");
        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, "real-no-submit-btn.png"),
          fullPage: true,
        });
        return;
      }
    }

    // 10. Click the second confirmation button "訂單沒問題👌"
    console.log("Looking for second confirmation button...");
    await page.waitForTimeout(2000);
    const confirmOrderBtn = page.locator('button:has-text("訂單沒問題")');
    if (await confirmOrderBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmOrderBtn.click();
      console.log("  Clicked 訂單沒問題👌 — order confirmed!");
    } else {
      console.log("  No second confirmation button found, order may have gone through.");
    }

    // Wait for confirmation page
    console.log("Waiting for confirmation page...");
    await page.waitForTimeout(5000);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);

    // 11. Capture confirmation page
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "confirmation.png"),
      fullPage: true,
    });
    console.log("  Screenshot saved: screenshots/confirmation.png");

    // Dump full page text
    const pageText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(
      path.join(DISCOVERY_DIR, "confirmation-text.txt"),
      pageText,
      "utf-8"
    );
    console.log("  Page text saved: discovery/confirmation-text.txt");

    // Dump page HTML too for deeper analysis
    const pageHtml = await page.evaluate(() => document.body.innerHTML);
    fs.writeFileSync(
      path.join(DISCOVERY_DIR, "confirmation-html.txt"),
      pageHtml,
      "utf-8"
    );

    // Try to extract pickup/order number
    const patterns = ["取餐號", "訂單編號", "號碼", "#", "編號", "Order"];
    console.log("\n--- Searching for order/pickup number ---");
    for (const pattern of patterns) {
      const lines = pageText.split("\n").filter((l) => l.includes(pattern));
      if (lines.length > 0) {
        console.log(`  Pattern "${pattern}" found:`);
        lines.forEach((l) => console.log(`    ${l.trim()}`));
      }
    }

    // Also try to find any prominent number
    const numberMatch = pageText.match(/(?:取餐號|號碼|編號)[：:\s]*(\d+)/);
    if (numberMatch) {
      console.log(`\n🎫 PICKUP NUMBER: ${numberMatch[1]}`);
    }

    const orderMatch = pageText.match(/(?:訂單編號|訂單號)[：:\s]*([A-Za-z0-9-]+)/);
    if (orderMatch) {
      console.log(`📋 ORDER NUMBER: ${orderMatch[1]}`);
    }

    // Print full page URL for reference
    console.log(`\nConfirmation URL: ${page.url()}`);

    // Keep browser open for manual inspection
    console.log("\nBrowser staying open for 30s for manual inspection...");
    await page.waitForTimeout(30000);

    console.log("\n✅ Done! Review:");
    console.log("  - screenshots/confirmation.png");
    console.log("  - discovery/confirmation-text.txt");
    console.log("  - discovery/confirmation-html.txt");
  } catch (err) {
    console.error("Error:", (err as Error).message);
    await page
      .screenshot({
        path: path.join(SCREENSHOTS_DIR, "real-error.png"),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
