import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { fuzzy } from "fast-fuzzy"
import names from "./names.json" assert { type: "json" }

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is not defined in the .env file")
}

const supabase = createClient(supabaseUrl, supabaseKey)

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

async function processMarker(context, markerIndex, url) {
  const page = await context.newPage()
  const dataObj = { reservoir: null }

  try {
    // Navigate to main page
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
    const markers = await page.$$(".leaflet-marker-icon.leaflet-interactive")

    if (!markers[markerIndex]) {
      console.warn(`Marker not found at index ${markerIndex}`)
      return null
    }

    // Close any existing popups and modals
    await page.evaluate(() => {
      document
        .querySelectorAll(".leaflet-popup-close-button")
        .forEach((btn) => btn.click())
      document.querySelectorAll(".modal-header .close").forEach((btn) => btn.click())
    })
    await page.waitForTimeout(500)

    // Click marker using JavaScript events
    await page.evaluate((index) => {
      const markerElems = document.querySelectorAll(
        ".leaflet-marker-icon.leaflet-interactive"
      )
      const marker = markerElems[index]
      marker.scrollIntoView({ behavior: "smooth", block: "center" })
      marker.dispatchEvent(
        new MouseEvent("click", { view: window, bubbles: true, cancelable: true })
      )
    }, markerIndex)

    await page.waitForSelector(".leaflet-popup-content", { timeout: 10000 })

    const fichaLink = await page.waitForSelector('a[href*="ficha"]', {
      state: "visible",
      timeout: 10000,
    })

    await fichaLink.click()
    await page.waitForSelector("#myModal", { state: "visible", timeout: 10000 })
    await page.waitForTimeout(2000)

    const data = await page.evaluate(() => {
      try {
        const modal = document.querySelector("#myModal")
        if (!modal) {
          console.error("Modal element not found")
          return { error: "Modal not found" }
        }

        const nameCell = modal.querySelector(
          "table:nth-child(1) tbody tr:nth-child(5) td.col-sm-5"
        )
        if (!nameCell) {
          console.error("Name cell not found")
          return { error: "Name cell not found", modalContent: modal.innerHTML }
        }

        // Add debug logging
        console.log("Modal content:", modal.innerHTML)
        console.log("Name cell content:", nameCell.textContent)

        const reservoir = {
          embalse: nameCell.textContent
            .trim()
            .replace("EMBALSE DE ", "")
            .replace("EMBALSE DEL ", "")
            .split(" ")
            .slice(0, -1)
            .join(" "),
          cota: 0,
          volumen: 0,
          porcentaje: 0,
          timestamp: new Date().toISOString(),
        }

        const table = modal.querySelector(".modal-body table:nth-child(2)")
        if (!table) {
          return {
            error: "Data table not found",
            modalTables: Array.from(modal.querySelectorAll("table")).length,
          }
        }

        let foundData = false
        table.querySelectorAll("tr").forEach((row, idx) => {
          const cells = row.querySelectorAll("td")
          if (cells.length >= 3) {
            const label = cells[0].textContent.trim().toLowerCase()
            const rawValue = cells[2].textContent.trim()

            // Handle 'n/d' values by setting them to 0
            if (rawValue === "n/d") {
              if (label.includes("volumen embalse")) reservoir.volumen = 0
              else if (label.includes("cota embalse")) reservoir.cota = 0
              else if (label.includes("porcentaje volumen")) reservoir.porcentaje = 0
              foundData = true // Consider 'n/d' as valid data with value 0
            } else {
              const value = parseFloat(rawValue.replace(",", "."))
              if (!isNaN(value)) {
                foundData = true
                if (label.includes("volumen embalse")) reservoir.volumen = value
                else if (label.includes("cota embalse")) reservoir.cota = value
                else if (label.includes("porcentaje volumen"))
                  reservoir.porcentaje = value
              }
            }
          }
        })

        // Also modify the data validation check:
        if (!foundData) {
          return {
            error: "No data found in table",
            reservoir: reservoir,
            tableContent: table.innerHTML,
          }
        }

        // Return the reservoir data even if some values are null
        return reservoir
      } catch (err) {
        return { error: `Error in page evaluation: ${err.message}` }
      }
    })

    if (data.error) {
      throw new Error(`Data extraction failed: ${JSON.stringify(data)}`)
    }

    dataObj.reservoir = data
  } catch (error) {
    console.error(`Error processing marker ${markerIndex + 1}:`, {
      error: error.message,
      url: url,
      markerIndex: markerIndex,
    })
  } finally {
    await page.close()
  }
  return dataObj.reservoir
}

async function scrapAndaluciaInterna() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  const url = "http://www.redhidrosurmedioambiente.es/saih/visor/visorE"
  const context = await browser.newContext()
  const page = await context.newPage()
  const allData = []

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    })
    const markers = await page.$$(".leaflet-marker-icon.leaflet-interactive")
    await page.close()

    // Batch size for concurrency
    const batchSize = 5
    for (let i = 0; i < markers.length; i += batchSize) {
      const batch = markers.slice(i, i + batchSize)
      const tasks = batch.map((_, idx) => {
        const markerIndex = i + idx
        return processMarker(context, markerIndex, url)
      })
      const results = await Promise.all(tasks)
      results.forEach((res) => {
        if (res) allData.push(res)
      })
    }
  } catch (error) {
    console.error("Scraping failed:", error)
  } finally {
    await context.close()
    await browser.close()
  }

  return allData
}

async function FuzzData(data) {
  const manualOverrides = {
    "la concepción": "Concepción",
    beninar: "Benínar",
    beznar: "Béznar",
    "embalse cuevas del almanzora": "Cuevas de Almanzora",
    "embalse arcos de la frontera": "Arcos de la Frontera",
  }

  const processedNames = new Set()

  return data.reduce((acc, item) => {
    if (item.embalse === 0) return acc

    let matchedName = item.embalse.toLowerCase()

    if (manualOverrides.hasOwnProperty(matchedName)) {
      const overrideName = manualOverrides[matchedName]
      if (processedNames.has(overrideName)) {
        console.log(`Skipping duplicate: ${overrideName}`)
        return acc
      }
      console.log(`Manual override: ${matchedName} -> ${overrideName}`)
      processedNames.add(overrideName)
      acc.push({ ...item, embalse: overrideName })
    } else {
      const { nombre, puntaje } = encontrarMejorCoincidencia(
        item.embalse.toLowerCase(),
        names
      )
      if (processedNames.has(nombre)) {
        console.log(`Skipping duplicate: ${nombre}`)
        return acc
      }
      console.log(`Matching: ${item.embalse} -> ${nombre} (score: ${puntaje})`)

      if (puntaje >= 0.9) {
        processedNames.add(nombre)
        acc.push({ ...item, embalse: nombre })
      } else {
        console.warn(`Low match score (< 0.9): ${item.embalse} -> ${nombre} (${puntaje})`)
      }
    }
    return acc
  }, [])
}

async function InsertData(data) {
  console.log(data)
  for (const row of data) {
    if (!row.embalse) continue

    console.log(`Processing ${row.embalse}...`)

    const { error } = await supabase.from("live_data").insert({
      id: `${row.embalse}_${row.timestamp}`,
      embalse: row.embalse,
      cota: row.cota,
      volumen: row.volumen,
      porcentaje: row.porcentaje,
      timestamp: row.timestamp,
    })

    if (error) {
      console.error(`Error inserting data for ${row.embalse}:`, error)
    } else {
      console.log(`Successfully inserted data for ${row.embalse}`)
    }
  }
}

async function main() {
  try {
    console.log("Starting Andalucia scraping...")
    let AllData = await scrapAndaluciaInterna()
    console.log("Applying fuzzy matching...")
    AllData = await FuzzData(AllData)
    console.log("Inserting data...")
    await InsertData(AllData)
    console.log("Process completed successfully")
  } catch (error) {
    console.error("Error in the process:", error)
  }
}

main()
