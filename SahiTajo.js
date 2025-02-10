import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { fuzzy } from "fast-fuzzy"
import names from "./names.json" assert { type: "json" }

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is not defined")
}

const supabase = createClient(supabaseUrl, supabaseKey)

const BROWSER_CONFIG = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-software-rasterizer",
    "--disable-features=site-per-process",
    "--disable-web-security",
  ],
}

const CONTEXT_CONFIG = {
  viewport: { width: 1920, height: 1080 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  bypassCSP: true,
}

async function waitForSelector(page, selector, options = {}) {
  const defaultOptions = {
    state: "visible",
    timeout: 15000,
  }
  try {
    return await page.waitForSelector(selector, { ...defaultOptions, ...options })
  } catch (error) {
    console.error(`Failed to find selector: ${selector}`)
    throw error
  }
}

async function safeClick(page, selector, options = {}) {
  await waitForSelector(page, selector)
  try {
    await page.click(selector, { force: true, ...options })
    await page.waitForTimeout(1000)
  } catch (error) {
    console.error(`Failed to click: ${selector}`)
    throw error
  }
}

function encontrarMejorCoincidencia(nombreScraped, nombresCorrectos) {
  let mejorPuntaje = -Infinity
  let mejorCoincidencia = nombreScraped

  for (const nombreCorrecto of nombresCorrectos) {
    const puntaje = fuzzy(nombreScraped, nombreCorrecto, {
      ignoreCase: true,
      normalize: true,
    })

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejorCoincidencia = nombreCorrecto
    }
  }

  return { nombre: mejorCoincidencia, puntaje: mejorPuntaje }
}

async function getMetricValues(page) {
  return await page.evaluate(() => {
    const getMetricValue = (titleText) => {
      const containers = document.querySelectorAll(".center.list-item__center")
      for (const container of containers) {
        const titulo = container.querySelector(".titulo-metrica-estacion .titulo")
        if (titulo?.textContent.includes(titleText)) {
          const destacado = container.querySelector(".dato-metrica-estacion.destacada")
          if (destacado) {
            const textNode = destacado.querySelector("span.label").nextSibling
            return textNode.nodeValue.trim()
          }
        }
      }
      return null
    }

    return [
      getMetricValue("COTA EMBALSE"),
      getMetricValue("VOLUMEN"),
      getMetricValue("VOLUMEN PORCENTUAL"),
    ]
  })
}

async function scrapTajo() {
  let browser
  let context
  const MAX_RETRIES = 3
  const AllData = []
  const processedEmbalses = new Set()

  try {
    browser = await chromium.launch(BROWSER_CONFIG)
    context = await browser.newContext(CONTEXT_CONFIG)
    const page = await context.newPage()

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await page.goto("https://saihtajo.chtajo.es/index.php#nav", {
          waitUntil: "networkidle",
          timeout: 30000,
        })

        await safeClick(
          page,
          'ons-toolbar-button.toolbar-button[href*="get-datos-tiempo-real"]'
        )
        await safeClick(
          page,
          '//ons-tab[@label="Tipologías"]//button[contains(@class, "tabbar__button")]'
        )

        const embButton =
          "#tabbar-datos-tiempo-real > div.tabbar__content.ons-tabbar__content.ons-swiper.tabbar--top__content > div.ons-swiper-target.active > ons-page:nth-child(3) > div.page__content > ons-list > ons-list-item:nth-child(4)"
        await safeClick(page, embButton)

        const firstExpandableSelector =
          "#tabbar-datos-tiempo-real > div.tabbar__content.ons-tabbar__content.ons-swiper.tabbar--top__content > div.ons-swiper-target.active > ons-page:nth-child(3) > div.page__content > ons-list > ons-list-item.list-item.list-item--expandable.list-item--expanded > div.expandable-content.list-item__expandable-content"
        await waitForSelector(page, firstExpandableSelector)

        const expandableItems = await page.$$(
          firstExpandableSelector + " > ons-list-item"
        )

        for (const item of expandableItems) {
          await item.click({ force: true })
          await page.waitForTimeout(1000)

          const nestedExpandableSelector =
            firstExpandableSelector +
            " > ons-list-item.list-item.list-item--expandable.list-item--expanded > div.expandable-content.list-item__expandable-content"
          await waitForSelector(page, nestedExpandableSelector)

          const embalses = await page.$$(nestedExpandableSelector + " > ons-list-item")

          for (const embalse of embalses) {
            const embalseName = await embalse.$eval(".center.list-item__center", (node) =>
              node.innerText.trim()
            )

            if (processedEmbalses.has(embalseName)) {
              console.warn(`Skipping duplicate: ${embalseName}`)
              continue
            }

            await embalse.scrollIntoViewIfNeeded()
            await embalse.click({ force: true })
            await page.waitForTimeout(1000)

            try {
              const [cotaValue, volumenValue, porcentajeValue] =
                await getMetricValues(page)
              const scrapedEmbalseName = await page.$eval(
                ".titulo-tarjeta-estacion",
                (node) => node.innerText
              )

              AllData.push({
                embalse: scrapedEmbalseName.split("-").slice(1).join("-").trim(),
                volumen: volumenValue,
                porcentaje: porcentajeValue,
                cota: cotaValue,
                timestamp: new Date().toISOString(),
              })

              processedEmbalses.add(embalseName)
              console.log("Processed:", embalseName)
            } catch (error) {
              console.warn(`Failed to process ${embalseName}:`, error.message)
            }

            await safeClick(page, "#cerrar-dialog-estacion")
          }
        }
        break
      } catch (error) {
        console.warn(`Attempt ${attempt} failed:`, error)
        if (attempt === MAX_RETRIES) throw error
        await page.waitForTimeout(2000)
      }
    }
    return AllData
  } catch (error) {
    console.error("Scraping failed:", error)
    throw error
  } finally {
    if (context) await context.close()
    if (browser) await browser.close()
  }
}

async function FuzzData(data) {
  const manualOverrides = {
    burguillo: "Burguillo",
    "guadiloba - caceres": "Cáceres - Guadiloba",
  }

  return data.reduce((acc, item) => {
    if (!item.embalse) return acc

    const matchedName = item.embalse.toLowerCase()

    if (manualOverrides[matchedName]) {
      acc.push({ ...item, embalse: manualOverrides[matchedName] })
    } else {
      const { nombre, puntaje } = encontrarMejorCoincidencia(matchedName, names)
      if (puntaje >= 0.9) {
        acc.push({ ...item, embalse: nombre })
      }
    }
    return acc
  }, [])
}

async function InsertData(data) {
  for (const row of data) {
    if (!row.embalse) continue

    try {
      const { error } = await supabase.from("live_data").insert({
        id: `${row.embalse}_${new Date().toISOString()}`,
        embalse: row.embalse,
        cota: row.cota ? parseFloat(row.cota.replace(",", ".")) : null,
        volumen: row.volumen ? parseFloat(row.volumen.replace(",", ".")) : null,
        porcentaje: row.porcentaje ? parseFloat(row.porcentaje.replace(",", ".")) : null,
        timestamp: row.timestamp,
      })

      if (error) throw error
      console.log(`Inserted data for ${row.embalse}`)
    } catch (error) {
      console.error(`Failed to insert ${row.embalse}:`, error)
    }
  }
}

async function main() {
  try {
    console.log("Starting scraping...")
    const scrapedData = await scrapTajo()
    console.log("Applying fuzzy matching...")
    const matchedData = await FuzzData(scrapedData)
    console.log("Inserting data...")
    await InsertData(matchedData)
    console.log("Process completed")
  } catch (error) {
    console.error("Process failed:", error)
    process.exit(1)
  }
}

main()
