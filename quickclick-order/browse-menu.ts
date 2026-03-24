import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const URL = "https://liff.line.me/1655733949-nV50V7b0?accountId=4989&type=catering&source=qc&token=fc33fb8335c17e18e729fce244f82c1b7f93b14fb269a270ab099a04d797304d";
const AUTH = path.resolve("auth.json");
const SHOTS = path.resolve("screenshots/menu-browse");
fs.mkdirSync(SHOTS, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/13.6.1",
    ...(fs.existsSync(AUTH) ? { storageState: AUTH } : {}),
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Dismiss any blocking modal (e.g. 公告)
  const modal = page.locator(".jquery-modal.blocker.current");
  if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  const SKIP = ["公告", "再點一次", "歡樂加價購"];
  const rawTabs = await page.locator("nav p").allTextContents();
  console.log("Categories:", rawTabs);

  for (const rawTab of rawTabs) {
    const tab = rawTab.trim().replace(/\d+$/, "").trim();
    if (SKIP.some(s => tab.includes(s))) continue;

    const t = page.locator("nav p").filter({ hasText: tab });
    if (await t.count() > 0) {
      await t.first().click();
      await page.waitForTimeout(800);
      const name = tab.replace(/[\/&\s]/g, "_");
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
      console.log(`Captured: ${tab}`);
    }
  }

  await browser.close();
  console.log(`\nScreenshots in: ${SHOTS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
