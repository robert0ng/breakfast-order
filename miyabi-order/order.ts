import { chromium, Page } from "playwright";
import { checkbox, input, select } from "@inquirer/prompts";
import * as path from "path";

const STORE_URL =
  "https://morning-web.cinpos.com/store/72a8ab38334095e37ff99f168a0484fb?orderType=TO_GO";
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
const PHONE_NUMBER = "0913936203";

interface MenuItem {
  name: string;
  price: number;
  index: number;
}

async function dismissModals(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll("ngb-modal-window, ngb-modal-backdrop")
      .forEach((e) => e.remove());
  });
  await page.waitForTimeout(300);
}

async function scrapeMenu(page: Page): Promise<MenuItem[]> {
  return page.evaluate(() => {
    const items: { name: string; price: number; index: number }[] = [];
    document.querySelectorAll(".menu-item").forEach((el, i) => {
      const nameEl = el.querySelector(".menu-item-content-name");
      const priceEl = el.querySelector(".menu-item-content-price");
      if (nameEl && priceEl) {
        const name = (nameEl as HTMLElement).innerText.trim();
        const priceText = (priceEl as HTMLElement).innerText.trim();
        const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10);
        if (name && !isNaN(price)) {
          items.push({ name, price, index: i });
        }
      }
    });
    return items;
  });
}

async function addItemToCart(page: Page, item: MenuItem, qty: number) {
  const itemLocator = page.locator(
    `.menu-item-content-name:has-text("${item.name}")`
  );
  await itemLocator.scrollIntoViewIfNeeded();
  await itemLocator.click();
  await page.waitForTimeout(1500);

  // Adjust quantity if > 1
  if (qty > 1) {
    const qtyPlus = page.locator('button:has-text("+")').first();
    for (let i = 1; i < qty; i++) {
      if (await qtyPlus.isVisible({ timeout: 1000 }).catch(() => false)) {
        await qtyPlus.click();
        await page.waitForTimeout(300);
      }
    }
  }

  // Click add to cart
  const addBtn = page.locator('button:has-text("新增")').first();
  await addBtn.scrollIntoViewIfNeeded();
  await addBtn.click();
  await page.waitForTimeout(1000);
}

async function goToCart(page: Page) {
  // The cart button can appear as "前往購物車(N)" or as a floating button
  // with just a number badge. Try multiple selectors.
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

  // Fallback: find the floating cart button by position (bottom of viewport)
  // It's a button near y=864-908 with a number like "1"
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    // Look for a button whose parent/sibling contains "購物車" text
    for (const btn of buttons) {
      const parent = btn.closest("[class*='cart'], [class*='float'], [class*='fixed']");
      if (parent && (parent as HTMLElement).offsetParent !== null) {
        btn.click();
        return true;
      }
    }
    // Fallback: click the button with just a number at the bottom
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
    // Last resort: navigate directly to cart URL
    const currentUrl = page.url();
    const cartUrl = currentUrl.replace(/\/store\//, "/store/").split("?")[0] + "/cart?orderType=TO_GO";
    await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
}

async function selectPickupTime(page: Page) {
  // The checkout page may show a modal about store being closed.
  // First, check if "預訂" option is available in the form.
  // If there's a modal with "預訂領取時間" button, click it.
  const bookModalBtn = page.locator('button:has-text("預訂領取時間")');
  if (await bookModalBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await bookModalBtn.click();
    await page.waitForTimeout(2000);
  } else {
    // Dismiss modal if present, then click "預訂" in the form
    await dismissModals(page);
    await page.waitForTimeout(500);

    const bookOption = page.locator("text=預訂").first();
    if (await bookOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bookOption.click();
      await page.waitForTimeout(2000);
    }
  }

  // Now the time booking modal should be open with a native <select>
  const timeSelect = page.locator('select[name="time"]');
  if (await timeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Get available time slots
    const options = await timeSelect.locator("option").allInnerTexts();
    const validOptions = options.filter((o) => o.match(/\d{2}:\d{2}/));

    if (validOptions.length === 0) {
      console.log("  No time slots available!");
      return;
    }

    // Let user pick a time
    const chosenTime = await select({
      message: "Select pickup time:",
      choices: validOptions.map((t) => ({ name: t, value: t })),
    });

    // Find the value attribute for the chosen time
    const optionValue = await timeSelect.evaluate(
      (sel, chosen) => {
        const option = Array.from((sel as HTMLSelectElement).options).find(
          (o) => o.text === chosen
        );
        return option?.value || "";
      },
      chosenTime
    );

    if (optionValue) {
      await timeSelect.selectOption(optionValue);
      console.log(`  Selected: ${chosenTime}`);
      await page.waitForTimeout(500);
    }

    // Click 確認時間
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

async function main() {
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
      await startBtn.click();
      await page.waitForTimeout(1500);
    }

    // 4. Scrape menu
    const menuItems = await scrapeMenu(page);
    if (menuItems.length === 0) {
      console.error("No menu items found!");
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, "error-no-menu.png"),
      });
      await browser.close();
      return;
    }

    console.log(`\nFound ${menuItems.length} menu items:\n`);
    menuItems.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.name}  $${item.price}`);
    });

    // 5. Interactive selection
    const selected = await checkbox({
      message: "Select items to order (space to toggle, enter to confirm):",
      choices: menuItems.map((item) => ({
        name: `${item.name}  $${item.price}`,
        value: item,
      })),
    });

    if (selected.length === 0) {
      console.log("No items selected. Exiting.");
      await browser.close();
      return;
    }

    // Ask quantity for each selected item
    const orderItems: { item: MenuItem; qty: number }[] = [];
    for (const item of selected) {
      const qtyStr = await input({
        message: `Quantity for ${item.name} ($${item.price}):`,
        default: "1",
      });
      const qty = parseInt(qtyStr, 10) || 1;
      orderItems.push({ item, qty });
    }

    // Print order summary
    let total = 0;
    console.log("\n=== Order Summary ===");
    for (const { item, qty } of orderItems) {
      const subtotal = item.price * qty;
      total += subtotal;
      console.log(`  ${item.name} x${qty}  $${subtotal}`);
    }
    console.log(`  ─────────────────`);
    console.log(`  Total: $${total}\n`);

    // 6. Add items to cart
    for (const { item, qty } of orderItems) {
      console.log(`Adding ${item.name} x${qty}...`);
      await addItemToCart(page, item, qty);
    }

    // 7. Go to cart
    console.log("Going to cart...");
    await goToCart(page);
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "order-cart.png"),
    });

    // 8. Proceed to checkout
    console.log("Proceeding to checkout...");
    const checkoutBtn = page.locator('button').filter({ hasText: '結帳' });
    await checkoutBtn.first().click();
    await page.waitForTimeout(5000);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    // 9. Handle pickup time
    console.log("Setting pickup time...");
    await selectPickupTime(page);

    // Dismiss any remaining modals
    await dismissModals(page);
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "order-checkout.png"),
      fullPage: true,
    });

    // 10. Fill in checkout form
    console.log("Filling checkout form...");

    // Fill 姓名 (name)
    const nameInput = page
      .locator('input[type="text"][placeholder="必填"]')
      .first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill("王");
      console.log("  Name: 王");
    }

    // Fill 手機號碼 (phone)
    const phoneInput = page.locator('input[type="tel"]');
    if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneInput.fill(PHONE_NUMBER);
      console.log(`  Phone: ${PHONE_NUMBER}`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "order-filled.png"),
      fullPage: true,
    });

    // 11. Submit order
    console.log("\nReady to submit order.");
    const confirmStr = await input({
      message: 'Type "yes" to submit the order, or "no" to cancel:',
    });

    if (confirmStr.toLowerCase() === "yes") {
      const submitBtn = page.locator('button:has-text("立即下單")');
      if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click();
        console.log("Order submitted!");
        await page.waitForTimeout(5000);
        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, "order-confirmation.png"),
          fullPage: true,
        });

        const confirmText = await page.evaluate(
          () => document.body.innerText
        );
        console.log("\n=== Confirmation ===");
        const orderMatch = confirmText.match(
          /訂單編號[：:]?\s*([A-Za-z0-9]+)/
        );
        if (orderMatch) {
          console.log(`Order number: ${orderMatch[1]}`);
        }
        console.log(confirmText.substring(0, 500));
      } else {
        console.log("Submit button not found/visible");
      }
    } else {
      console.log("Order cancelled.");
    }

    console.log("\nDone! Check screenshots/ for visual record.");
  } catch (err) {
    console.error("Error:", (err as Error).message);
    await page
      .screenshot({
        path: path.join(SCREENSHOTS_DIR, "error.png"),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
