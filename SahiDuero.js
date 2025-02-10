import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { fuzzy } from "fast-fuzzy"
import names from "./names.json" assert { type: "json" }

// Configuration
dotenv.config()

// Supabase configuration
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is not defined in the .env file")
}

const supabase = createClient(supabaseUrl, supabaseKey)

const chunk = (array, size) => {
  const chunks = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

async function processReservoirBatch(links, browser) {
  const promises = links.map(async (link) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      console.log(`Processing reservoir: ${link.name}`)
      await page.goto(link.href, { waitUntil: "networkidle" })
      const data = await getDetailedData(page, link.name)
      return data
    } catch (error) {
      console.error(`Error processing reservoir ${link.name}:`, error)
      return null
    } finally {
      await context.close()
    }
  })

  const results = await Promise.all(promises)
  return results.filter(Boolean)
}

async function scrapDuero() {
  const browser = await chromium.launch({
    args: ["--disable-dev-shm-usage"],
  })
  const AllData = []
  const BATCH_SIZE = 5
  const DELAY_BETWEEN_BATCHES = 2000

  try {
    const page = await browser.newPage()
    await loadPageWithRetry(page, 3)
    await page.waitForSelector("table", { state: "visible" })

    const reservoirLinks = await page.$$eval("tr td:first-child a", (links) =>
      links.map((link) => ({
        name: link.textContent.trim(),
        href: link.href,
      }))
    )

    const batches = chunk(reservoirLinks, BATCH_SIZE)

    for (const batch of batches) {
      const batchResults = await processReservoirBatch(batch, browser)
      AllData.push(...batchResults)
      await delay(DELAY_BETWEEN_BATCHES)
    }

    return AllData
  } finally {
    await browser.close()
    console.log("Browser closed")
  }
}

async function loadPageWithRetry(page, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to load page (attempt ${attempt}/${maxRetries})...`)
      await page.goto("https://www.saihduero.es/situacion-embalses", {
        waitUntil: "networkidle",
        timeout: 30000,
      })
      console.log("Page loaded successfully.")
      return
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`Max retries reached. Failed to load page.`)
        throw error
      }
      console.log(`Attempt ${attempt} failed, retrying...`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

async function getDetailedData(page, embalse) {
  const tableSelector =
    "#main-wrapper > div > div > div:nth-child(2) > div > div:nth-child(3) > div > div > table"
  try {
    console.log(`Fetching detailed data for ${embalse}...`)
    await page.waitForSelector(tableSelector, { state: "visible", timeout: 5000 })

    const values = await page.$$eval(`${tableSelector} tbody tr`, (rows) => {
      const desiredValues = {
        nivel: null,
        volumen: null,
        porcentaje: null,
      }

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td")
        if (cells.length < 2) return

        const labelCell = cells[0].textContent.trim()
        const valueCell = cells[1]?.childNodes[0]?.textContent?.trim() || null

        if (labelCell === "Nivel") {
          desiredValues.nivel = valueCell.replace(".", "").replace(",", ".").trim()
        } else if (labelCell === "Volumen embalsado") {
          desiredValues.volumen = valueCell.replace(".", "").replace(",", ".").trim()
        } else if (labelCell === "Porcentaje de volumen embalsado") {
          desiredValues.porcentaje = valueCell.replace(".", "").replace(",", ".").trim()
        }
      })

      return [desiredValues.nivel, desiredValues.volumen, desiredValues.porcentaje]
    })

    const reservoirData = {
      embalse,
      nivel: values[0],
      volumen: values[1],
      porcentaje: values[2],
    }

    console.log(`Detailed data fetched successfully for ${embalse}.`)
    return reservoirData
  } catch (error) {
    console.error(`Error getting detailed data for ${embalse}: ${error.message}`)
    return null
  }
}

async function saveDataToSupabase(data) {
  console.log("Saving data to Supabase...")
  for (const row of data) {
    try {
      const { error } = await supabase.from("live_data").insert({
        id: `${row.embalse}_${new Date().toISOString()}`,
        embalse: row.embalse,
        cota: row.nivel ? parseFloat(row.nivel) : null,
        volumen: row.volumen ? parseFloat(row.volumen) : null,
        porcentaje: row.porcentaje ? parseFloat(row.porcentaje) : null,
        timestamp: new Date().toISOString(),
      })

      if (error) {
        console.error(
          `Error inserting data for ${row.embalse} in Supabase:`,
          error.message
        )
      } else {
        console.log(`Data for ${row.embalse} saved successfully to Supabase.`)
      }
    } catch (error) {
      console.error(`Failed to save data for ${row.embalse}:`, error)
    }
  }
  console.log("Data saving to Supabase completed.")
}

async function FuzzData(data) {
  const manualOverrides = {
    "cervera-ruesga": "Cervera",
    "la requejada": "Requejada",
  }

  return data.reduce((acc, item) => {
    if (item.embalse === 0) {
      return acc
    }

    let matchedName = item.embalse.toLowerCase()

    if (manualOverrides.hasOwnProperty(matchedName)) {
      const overrideName = manualOverrides[matchedName]
      matchedName = overrideName
      console.log(`Matching: ${item.embalse} -> ${matchedName} (override)`)
      acc.push({ ...item, embalse: matchedName })
    } else {
      const { nombre, puntaje } = encontrarMejorCoincidencia(
        item.embalse.toLowerCase(),
        names
      )
      console.log(`Matching: ${item.embalse} -> ${nombre} (score: ${puntaje.toFixed(2)})`)
      if (puntaje >= 0.9) {
        acc.push({ ...item, embalse: nombre })
      } else {
        console.warn(
          `Low match score (${puntaje}) for "${item.embalse}" -> Best match: "${nombre}"`
        )
      }
    }
    return acc
  }, [])
}

async function main() {
  try {
    console.log("Starting Duero scraping...")
    const data = await scrapDuero()
    const fuzzedData = await FuzzData(data)
    console.log("Data extracted and processed successfully")
    console.log("Saving data to Supabase...")
    await saveDataToSupabase(fuzzedData)
    console.log("Duero scraping process completed successfully")
  } catch (error) {
    console.error("Error in the Duero scraping process:", error)
  }
}

main()
