import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import nombres from "./names.json" assert { type: "json" }
import { fuzzy } from "fast-fuzzy"

// Configuration
dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is not defined in the .env file")
}

const supabase = createClient(supabaseUrl, supabaseKey)

const insertData = async (data) => {
  console.log("\n💾 Starting database insertion...")
  console.log(`📊 Processing ${data.length} entries`)

  let insertCount = 0
  for (const row of data) {
    try {
      const { error } = await supabase.from("live_data").insert({
        id: `${row.nombre}_${new Date().toISOString()}`,
        embalse: row.nombre,
        cota: row.cota,
        volumen: row.volumen,
        porcentaje: row.porcentaje,
        timestamp: row.timestamp,
      })

      if (error) {
        console.error(`❌ Error inserting data for ${row.nombre}:`, error.message)
      } else {
        insertCount++
      }
    } catch (error) {
      console.error(`❌ Error inserting data for ${row.nombre}:`, error)
    }
  }
  console.log(`✅ Successfully inserted ${insertCount} entries into the database.`)
}

// Function to find the best match
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

// Modified Guadalquivir scraper
async function scrapGuadalquivir() {
  console.log("🚀 Initializing browser...")
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const page = await browser.newPage()
  console.log("📄 New page created")

  try {
    console.log("🌐 Navigating to SAIH Guadalquivir website...")
    await page.goto("https://www.chguadalquivir.es/saih/EmbalNiv.aspx", {
      waitUntil: "networkidle",
      timeout: 30000,
    })
    console.log("✅ Page loaded")
    await page.waitForSelector("table", { state: "visible" })

    const zones = await page.$$eval("#DDBzona option", (options) =>
      options.map((opt) => ({
        value: opt.value,
        text: opt.textContent.trim(),
      }))
    )

    let allData = []
    let zoneCount = 0

    for (const zone of zones) {
      zoneCount++
      console.log(`\n🗺️  Processing Zone ${zoneCount}/${zones.length}`)
      try {
        await page.selectOption("#DDBzona", zone.value)
        await page.waitForTimeout(2000)

        const zoneData = await page.$$eval(
          ".gridViewPersonalizado tr:not(:first-child)",
          (rows) => {
            return rows
              .map((row) => {
                const cells = row.querySelectorAll("td")
                if (cells.length < 3) return null

                const embalse = cells[0]?.textContent
                const nmn = cells[2]?.textContent
                const volumen = cells[5]?.textContent
                const porcentaje = cells[7]?.textContent

                if (embalse && nmn) {
                  const nombre = embalse.trim().slice(3, -4).trim()
                  return {
                    nombre,
                    cota: nmn.replace(",", "."),
                    volumen: volumen.replace(",", "."),
                    porcentaje: porcentaje.replace(",", "."),
                    timestamp: new Date().toISOString(),
                  }
                }
                return null
              })
              .filter(Boolean)
          }
        )
        allData.push(...zoneData)
      } catch (error) {
        console.error(`❌ Error processing zone ${zone.text}:`, error)
        continue
      }
    }

    // Manual overrides
    const manualOverrides = {
      guadanuño: 0,
      hornachuelos: 0,
      "contraemb. bermejales": 0,
      bermejales: 0,
      dañador: 0,
      encinarejo: 0,
      "el agrio": 0,
    }

    // Apply fuzzy matching to all names
    let processedCount = 0
    allData = allData.map((item) => {
      processedCount++
      const { nombre, puntaje } = encontrarMejorCoincidencia(
        item.nombre.toLowerCase(),
        nombres
      )
      return {
        ...item,
        nombre: nombre,
      }
    })
    console.log(`✅ Fuzzy matching complete. Processed ${processedCount} entries.`)

    allData = allData
      .map((item) => {
        if (manualOverrides.hasOwnProperty(item.nombre.toLowerCase())) {
          const overrideValue = manualOverrides[item.nombre.toLowerCase()]
          if (overrideValue === 0) {
            return null
          } else {
            return { ...item, nombre: overrideValue }
          }
        }
        return item
      })
      .filter(Boolean)

    // Remove duplicates using a Set
    const uniqueData = Array.from(
      new Map(allData.map((item) => [item.nombre, item])).values()
    )

    return uniqueData
  } catch (error) {
    console.error("❌ Scraping failed:", error)
    throw error // Re-throw the error to be caught by the main function
  } finally {
    await browser.close()
    console.log("🔒 Browser closed")
  }
}

async function main() {
  console.log("🎯 Starting Guadalquivir scraping process...")
  console.time("Total execution time")

  try {
    console.log("\n📊 Phase 1: Web scraping...")
    const datosGuadalquivir = await scrapGuadalquivir()

    console.log("\n💾 Phase 2: Database insertion...")
    await insertData(datosGuadalquivir)

    console.log("\n✨ Process completed successfully")
  } catch (error) {
    console.error("\n💥 Error in the process:", error)
  } finally {
    console.timeEnd("Total execution time")
  }
}

main()
