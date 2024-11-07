import { chromium } from "@playwright/test"

export default async function Sorteo() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto("https://www.saihguadiana.com/E/DATOS", { waitUntil: "networkidle" })

  const data = await page.$$eval("tr", (rows) => {
    return rows
      .map((row) => {
        const nombre = row.querySelector("td.mat-column-nombre")?.textContent.trim()
        const valor = row.querySelector("td.mat-column-NE1")?.textContent.trim()
        return nombre && valor ? `${nombre} : ${valor}` : null
      })
      .filter(Boolean)
  })

  console.log(data)
  await browser.close()
}

Sorteo()
