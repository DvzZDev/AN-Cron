import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

// Initial configuration
dotenv.config()
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is not defined in the .env file")
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Guadiana scraper
async function scrapGuadiana() {
  console.log("🚀 Initializing browser...")
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const page = await browser.newPage()
  console.log("📄 New page created")
  const MAX_RETRIES = 3
  let allData = []

  try {
    console.log("🌐 Navigating to SAIH Guadiana website...")
    // Add timeout and retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${MAX_RETRIES}`)
        await page.goto("https://www.saihguadiana.com/E/DATOS", {
          waitUntil: "networkidle",
          timeout: 30000,
        })
        console.log("✅ Page loaded")
        break
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error
        console.log(`❌ Attempt ${attempt} failed, retrying...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    console.log("📊 Extracting data...")
    // Extract data first, then process
    const rowsData = await page.$$eval("tr", (rows) => {
      return rows.map((row) => ({
        nombre: row.querySelector("td.mat-column-nombre")?.textContent?.trim() || null,
        cota: row.querySelector("td.mat-column-NE1")?.textContent?.trim() || null,
        volumen: row.querySelector("td.mat-column-VE1")?.textContent?.trim() || null,
        porcentaje: row.querySelector("td.mat-column-PV1")?.textContent?.trim() || null,
        timestamp:
          row.querySelector("td.mat-column-timestamp")?.textContent?.trim() || null,
      }))
    })
    allData = rowsData
  } catch (error) {
    console.error("❌ Scraping failed:", error)
    throw error
  } finally {
    await browser.close()
    console.log("🔒 Browser closed")
  }
  return allData
}

// Main function
async function main() {
  console.log("🎯 Starting Guadiana scraping process...")
  console.time("Total execution time")

  try {
    console.log("\n📊 Phase 1: Web scraping...")
    const data = await scrapGuadiana()

    console.log("\n💾 Phase 2: Database insertion...")
    console.log(`📊 Processing ${data.length} entries`)

    let insertCount = 0
    for (const row of data) {
      if (!row.nombre) {
        console.warn("⚠️ Skipping entry with no reservoir name")
        continue
      }
      try {
        const { error } = await supabase.from("live_data").insert({
          id: `${row.nombre}_${new Date().toISOString()}`,
          embalse: row.nombre,
          cota: row.cota ? parseFloat(row.cota.replace(",", ".")) : null,
          volumen: row.volumen ? parseFloat(row.volumen.replace(",", ".")) : null,
          porcentaje: row.porcentaje
            ? parseFloat(row.porcentaje.replace(",", "."))
            : null,
          timestamp: row.timestamp,
        })

        if (error) {
          console.error(`❌ Error inserting data for ${row.nombre}:`, error)
        } else {
          insertCount++
        }
      } catch (error) {
        console.error(`❌ Error inserting data for ${row.nombre}:`, error)
      }
    }
    console.log(`✅ Successfully inserted ${insertCount} entries into the database.`)

    console.log("✨ Process completed successfully")
  } catch (error) {
    console.error("💥 Error in the process:", error)
  } finally {
    console.timeEnd("Total execution time")
  }
}

// Execute script
main()
