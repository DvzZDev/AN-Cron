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

async function scrapEbro() {
  console.log("🚀 Initializing browser...")
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  const page = await browser.newPage()
  console.log("📄 New page created")
  const allData = []

  try {
    console.log("🌐 Navigating to SAIH Segura website...")
    await page.goto("https://saihweb.chsegura.es/apps/iVisor/embalses3.php", {
      waitUntil: "networkidle",
    })
    console.log("✅ Page loaded")
    await page.waitForSelector("#historico > div:nth-child(4) > div:nth-child(2)")
    console.log("✅ Data loaded")
    const data = await page.evaluate(() => {
      const divs = document.querySelectorAll(
        'div[style="width:100%;float:left;height:18px;text-align:right;color:#FFFFFF;"]'
      )
      const results = []

      divs.forEach((div) => {
        const embalse = div
          .querySelector("div:nth-child(1) a")
          .textContent.trim()
          .replace(/\s*\([^)]*\)/, "")
          .replace("E.", "")

        const cota = null
        const volumen = div
          .querySelector("div:nth-child(3) a")
          .textContent.trim()
          .replace(",", ".")
        const porcentaje = div
          .querySelector("div:nth-child(4)")
          .textContent.trim()
          .replace(",", ".")
        const timestamp = new Date().toISOString()

        results.push({ embalse, cota, volumen, porcentaje, timestamp })
      })

      return results
    })

    if (data.length > 0) {
      allData.push(...data)
    }
    const specificDivContent = await page.$eval(
      "#historico > div:nth-child(4) > div:nth-child(2)",
      (el) => el.textContent.trim()
    )
    console.log("Specific div content:", specificDivContent)
  } catch (error) {
    console.error("❌ Scraping failed:", error)
  } finally {
    console.log("🔒 Closing browser...")
    await browser.close()
  }

  return allData
}

async function FuzzData(data) {
  console.log("\n🔤 Starting fuzzy matching...")
  console.log(`📊 Processing ${data.length} reservoir entries`)

  const manualOverrides = {
    "la estanca": "Alcañiz (Estanca)",
    "puente santolea": "Puente de Santolea",
    "cañon-santolea": "Cañón de Santolea",
    "aranda-maidevera": "Maidevera",
    val: 0,
  }

  let processedCount = 0
  const result = data
    .map((item) => {
      processedCount++
      if (item.embalse === 0) {
        console.warn("⚠️ Skipping invalid reservoir name")
        return null
      }

      let matchedName = item.embalse.toLowerCase()

      if (manualOverrides.hasOwnProperty(matchedName)) {
        matchedName = manualOverrides[matchedName]
      } else {
        const { nombre, puntaje } = encontrarMejorCoincidencia(
          item.embalse.toLowerCase(),
          names
        )
        if (puntaje >= 0.9) {
          matchedName = nombre
        } else {
          console.warn(`❌ Rejected match: Score too low for ${item.embalse}`)
          return null
        }
      }
      return { ...item, embalse: matchedName }
    })
    .filter((item) => item !== null)

  console.log(`✅ Fuzzy matching complete. Processed ${processedCount} entries.`)
  return result
}

async function InsertData(data) {
  console.log("\n💾 Starting database insertion...")
  console.log(`📊 Processing ${data.length} entries`)

  let insertCount = 0
  for (const row of data) {
    if (!row.embalse) {
      console.warn("⚠️ Skipping entry with no reservoir name")
      continue
    }

    try {
      const { error } = await supabase.from("live_data").insert({
        id: `${row.embalse}_${new Date().toISOString()}`,
        embalse: row.embalse,
        cota: row.cota,
        volumen: row.volumen,
        porcentaje: row.porcentaje,
        timestamp: row.timestamp,
      })

      if (error) {
        console.error(`❌ Error inserting data for ${row.embalse}:`, error)
      } else {
        insertCount++
      }
    } catch (error) {
      console.error(`❌ Error inserting data for ${row.embalse}:`, error)
    }
  }
  console.log(`✅ Successfully inserted ${insertCount} entries into the database.`)
}

async function main() {
  console.log("🎯 Starting Segura scraping process...")
  console.time("Total execution time")

  try {
    console.log("\n📊 Phase 1: Web scraping...")
    let AllData = await scrapEbro()

    console.log("\n🔤 Phase 2: Data processing...")
    AllData = await FuzzData(AllData)

    console.log("\n💾 Phase 3: Database insertion...")
    await InsertData(AllData)

    console.log("\n✨ Process completed successfully")
  } catch (error) {
    console.error("\n💥 Fatal error:", error.message)
  } finally {
    console.timeEnd("Total execution time")
  }
}

main()
