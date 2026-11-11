// Renders the PNG icons from the SVG sources. Run after changing an SVG:
//   node scripts/render-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const targets = [
  { svg: "src/app/icon.svg", size: 192, out: "public/icons/icon-192.png" },
  { svg: "src/app/icon.svg", size: 512, out: "public/icons/icon-512.png" },
  { svg: "design/icon-maskable.svg", size: 512, out: "public/icons/icon-maskable-512.png" },
  // iOS draws its own rounded mask and shows transparency as black: full-bleed source.
  { svg: "design/icon-maskable.svg", size: 180, out: "src/app/apple-icon.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { svg, size, out } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const data = Buffer.from(readFileSync(svg)).toString("base64");
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style>` +
      `<img src="data:image/svg+xml;base64,${data}">`,
  );
  writeFileSync(out, await page.screenshot({ omitBackground: true }));
  console.log(out);
}
await browser.close();
