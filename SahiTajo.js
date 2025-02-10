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

async function scrapTajo() {
  let browser
  let context
  const AllData = []
  const processedEmbalses = new Set()

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
      ],
    })

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    })

    const page = await context.newPage()

    await page.goto("https://saihtajo.chtajo.es/index.php#nav", {
      waitUntil: "networkidle",
      timeout: 60000,
    })

    // Click datos tiempo real
    await page.waitForSelector(
      'ons-toolbar-button.toolbar-button[href*="get-datos-tiempo-real"]',
      { timeout: 30000 }
    )
    await page.click('ons-toolbar-button.toolbar-button[href*="get-datos-tiempo-real"]')
    await page.waitForTimeout(3000)

    // Click tipologías
    await page.waitForSelector('//ons-tab[@label="Tipologías"]', { timeout: 30000 })
    await page.click('//ons-tab[@label="Tipologías"]')
    await page.waitForTimeout(3000)

    // Click Embalses
    const embalsesSelector = 'ons-list-item.list-item:has-text("Embalses")'
    await page.waitForSelector(embalsesSelector, { timeout: 30000, state: "visible" })
    await page.click(embalsesSelector)
    await page.waitForTimeout(3000)

    // Get expandable categories
    const expandableItems = await page.$$("ons-list-item.list-item--expandable")

    for (const item of expandableItems) {
      await item.click()
      await page.waitForTimeout(2000)

      const embalses = await page.$$("ons-list-item:not(.list-item--expandable)")

      for (const embalse of embalses) {
        const embalseName = await embalse.evaluate((node) => node.innerText.trim())

        if (processedEmbalses.has(embalseName)) {
          console.log(`Skipping duplicate: ${embalseName}`)
          continue
        }

        await embalse.scrollIntoViewIfNeeded()
        await embalse.click()
        await page.waitForTimeout(2000)

        try {
          const [cotaValue, volumenValue, porcentajeValue] = await page.evaluate(() => {
            const getMetricValue = (titleText) => {
              const containers = document.querySelectorAll(".center.list-item__center")
              for (const container of containers) {
                const titulo = container.querySelector(".titulo-metrica-estacion .titulo")
                if (titulo?.textContent.includes(titleText)) {
                  const destacado = container.querySelector(
                    ".dato-metrica-estacion.destacada"
                  )
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

          const scrapedEmbalseName = await page.$eval(
            ".titulo-tarjeta-estacion",
            (node) => node.innerText.split("-").slice(1).join("-").trim()
          )

          AllData.push({
            embalse: scrapedEmbalseName,
            volumen: volumenValue,
            porcentaje: porcentajeValue,
            cota: cotaValue,
            timestamp: new Date().toISOString(),
          })

          processedEmbalses.add(embalseName)
          console.log("Processed:", embalseName)

          await page.click("#cerrar-dialog-estacion")
          await page.waitForTimeout(1000)
        } catch (error) {
          console.warn(`Failed to process ${embalseName}:`, error.message)
          continue
        }
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
