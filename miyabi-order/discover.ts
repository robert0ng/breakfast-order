import { chromium, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const STORE_URL =
  "https://morning-web.cinpos.com/store/72a8ab38334095e37ff99f168a0484fb?orderType=TO_GO";

const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
const DISCOVERY_DIR = path.join(__dirname, "discovery");

interface ApiCall {
  method: string;
  url: string;
  status?: number;
  contentType?: string;
}

async function main() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(DISCOVERY_DIR, { recursive: true });

  const apiCalls: ApiCall[] = [];

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  // Log all network requests
  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("api") ||
      url.includes("graphql") ||
      url.includes("menu") ||
      url.includes("store") ||
      url.includes("order") ||
      url.includes("cart") ||
      url.includes("cinpos")
    ) {
      apiCalls.push({
        method: req.method(),
        url,
      });
    }
  });

  page.on("response", (res) => {
    const url = res.url();
    const matching = apiCalls.find(
      (c) => c.url === url && c.status === undefined
    );
    if (matching) {
      matching.status = res.status();
      matching.contentType = res.headers()["content-type"] || "";
    }
  });

  console.log("Navigating to store...");
  await page.goto(STORE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // Screenshot landing page
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, "landing.png"),
    fullPage: true,
  });
  console.log("Saved: screenshots/landing.png");

  // Dump DOM
  const html = await page.content();
  fs.writeFileSync(path.join(DISCOVERY_DIR, "landing.html"), html);
  console.log("Saved: discovery/landing.html");

  // Log visible text elements for understanding structure
  const visibleText = await page.evaluate(() => {
    const elements = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, span, button, a, label, [class*='item'], [class*='menu'], [class*='product'], [class*='card']"
    );
    return Array.from(elements)
      .map((el) => ({
        tag: el.tagName,
        text: (el as HTMLElement).innerText?.trim().substring(0, 100),
        classes: el.className,
        id: el.id,
      }))
      .filter((e) => e.text);
  });
  fs.writeFileSync(
    path.join(DISCOVERY_DIR, "visible-elements.json"),
    JSON.stringify(visibleText, null, 2)
  );
  console.log("Saved: discovery/visible-elements.json");

  // Try to find and interact with menu items
  console.log("\nExploring menu items...");
  await exploreMenuItems(page);

  // Try clicking the first menu item to see item detail page
  await exploreItemDetail(page);

  // Try to find cart / checkout flow
  await exploreCartFlow(page);

  // Save API calls
  fs.writeFileSync(
    path.join(DISCOVERY_DIR, "api-calls.json"),
    JSON.stringify(apiCalls, null, 2)
  );
  console.log(`\nSaved: discovery/api-calls.json (${apiCalls.length} calls)`);

  // Summary
  console.log("\n=== Discovery Summary ===");
  console.log(`Total API calls captured: ${apiCalls.length}`);
  const uniqueEndpoints = [
    ...new Set(apiCalls.map((c) => new URL(c.url).pathname)),
  ];
  console.log("Unique endpoints:");
  uniqueEndpoints.forEach((ep) => console.log(`  ${ep}`));

  await browser.close();
  console.log("\nDiscovery complete! Review screenshots/ and discovery/ dirs.");
}

async function exploreMenuItems(page: Page) {
  // Look for clickable menu items / product cards
  const selectors = [
    '[class*="item"]',
    '[class*="product"]',
    '[class*="card"]',
    '[class*="menu"]',
    '[class*="dish"]',
    '[class*="food"]',
    "li",
    '[role="button"]',
    '[data-testid]',
  ];

  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`  Found ${count} elements matching: ${sel}`);
    }
  }

  // Take a screenshot of the menu area
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, "menu-area.png"),
    fullPage: true,
  });
}

async function exploreItemDetail(page: Page) {
  // Try clicking the first thing that looks like a menu item
  const candidates = page.locator(
    '[class*="item"], [class*="product"], [class*="card"]'
  );
  const count = await candidates.count();

  if (count > 0) {
    console.log("\nClicking first menu item candidate...");
    try {
      await candidates.first().click({ timeout: 3000 });
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, "item-detail.png"),
        fullPage: true,
      });
      console.log("Saved: screenshots/item-detail.png");

      // Dump the detail page DOM
      const detailHtml = await page.content();
      fs.writeFileSync(
        path.join(DISCOVERY_DIR, "item-detail.html"),
        detailHtml
      );

      // Look for add-to-cart buttons
      const buttons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("button")).map((b) => ({
          text: b.innerText?.trim(),
          classes: b.className,
          disabled: b.disabled,
        }));
      });
      fs.writeFileSync(
        path.join(DISCOVERY_DIR, "buttons.json"),
        JSON.stringify(buttons, null, 2)
      );
      console.log("Saved: discovery/buttons.json");

      // Try to go back
      await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log("  Could not click item:", (e as Error).message);
    }
  }
}

async function exploreCartFlow(page: Page) {
  // Look for cart icon or checkout button
  const cartSelectors = [
    '[class*="cart"]',
    '[class*="basket"]',
    '[class*="checkout"]',
    '[class*="bag"]',
    'button:has-text("購物車")',
    'button:has-text("結帳")',
    'a:has-text("購物車")',
  ];

  console.log("\nLooking for cart/checkout elements...");
  for (const sel of cartSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        console.log(`  Found ${count} elements matching: ${sel}`);
      }
    } catch {
      // ignore invalid selectors
    }
  }

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, "cart-area.png"),
    fullPage: true,
  });
}

main().catch(console.error);
