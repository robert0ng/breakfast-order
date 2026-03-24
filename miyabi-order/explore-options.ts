import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const STORE_URL =
  "https://morning-web.cinpos.com/store/72a8ab38334095e37ff99f168a0484fb?orderType=TO_GO";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    locale: "zh-TW",
  });
  const page = await context.newPage();

  await page.goto(STORE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    document.querySelectorAll("ngb-modal-window, ngb-modal-backdrop").forEach(e => e.remove());
  });
  await page.waitForTimeout(500);

  // Click 招牌火腿蛋吐司
  const item = page.locator('.menu-item-content-name:has-text("招牌火腿蛋吐司")');
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await page.waitForTimeout(2000);

  // Screenshot the item detail
  await page.screenshot({ path: path.join("screenshots", "options-detail.png"), fullPage: true });

  // Get all the customization options (醬料, 調整, etc.)
  const optionsHtml = await page.evaluate(() => {
    // Find the item detail section
    const detail = document.querySelector('[class*="detail"], [class*="option"], [class*="customize"]');
    if (detail) return detail.outerHTML.substring(0, 5000);

    // Fallback: get all text from the expanded item area
    const sections = document.querySelectorAll('[class*="section"], [class*="group"], [class*="category"]');
    let html = "";
    sections.forEach(s => {
      const t = (s as HTMLElement).innerText;
      if (t && (t.includes("醬料") || t.includes("調整") || t.includes("加") || t.includes("不要"))) {
        html += s.outerHTML.substring(0, 2000) + "\n";
      }
    });
    return html || "not found";
  });

  // Get all visible checkboxes, radio buttons, and toggles
  const controls = await page.evaluate(() => {
    const results: any[] = [];
    // Check for checkboxes/radios
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
      const label = el.closest("label")?.innerText?.trim() ||
        el.parentElement?.innerText?.trim() || "";
      results.push({
        type: (el as HTMLInputElement).type,
        checked: (el as HTMLInputElement).checked,
        label,
        visible: (el as HTMLElement).offsetParent !== null,
      });
    });
    // Check for custom toggle/chip elements
    document.querySelectorAll('[class*="chip"], [class*="toggle"], [class*="option"], [class*="tag"]').forEach(el => {
      const text = (el as HTMLElement).innerText?.trim();
      if (text && (el as HTMLElement).offsetParent !== null) {
        results.push({
          type: "custom",
          tag: el.tagName,
          classes: el.className.substring(0, 60),
          text,
          visible: true,
        });
      }
    });
    return results;
  });
  console.log("Customization controls:");
  controls.forEach(c => console.log(`  ${JSON.stringify(c)}`));

  // Get all text sections in the item detail
  const detailText = await page.evaluate(() => {
    // Find elements between the item name and the add button
    const nameEl = document.querySelector('.menu-item-content-name');
    const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.includes('新增'));
    if (!nameEl || !addBtn) return "could not find boundaries";

    // Walk siblings/parents to find the detail container
    let container = nameEl.closest('.menu-item');
    if (!container) container = nameEl.parentElement;

    // Get all inner text
    return container?.innerText || "no text";
  });
  console.log("\nItem detail text:");
  console.log(detailText);

  // Also try scrolling within the detail to see 調整 section
  // The detail might be in an expandable section
  const adjustSection = page.locator('text=調整');
  if (await adjustSection.count() > 0) {
    console.log("\n調整 section found!");
    await adjustSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join("screenshots", "options-adjust.png") });

    // Get siblings of 調整
    const adjustOptions = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('*')).find(
        e => (e as HTMLElement).innerText?.trim() === '調整'
      );
      if (!heading) return [];
      // Get the next sibling or parent's children
      let parent = heading.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        const text = parent.innerText;
        if (text.length > 20) {
          return text.split('\n').filter((l: string) => l.trim());
        }
        parent = parent.parentElement!;
      }
      return [];
    });
    console.log("調整 options:", adjustOptions);
  }

  await browser.close();
}

main().catch(console.error);
