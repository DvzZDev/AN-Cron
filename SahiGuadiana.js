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
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const MAX_RETRIES = 3

  try {
    // Add timeout and retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await page.goto("https://www.saihguadiana.com/E/DATOS", {
          waitUntil: "networkidle",
          timeout: 30000,
        })
        break
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error
        console.log(`Attempt ${attempt} failed, retrying...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

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

    for (const row of rowsData) {
      if (!row.nombre) continue

      console.log(`Processing ${row.nombre}...`)

      const { error } = await supabase.from("live_data").insert({
        id: `${row.nombre}_${new Date().toISOString()}`,
        embalse: row.nombre,
        cota: row.cota ? parseFloat(row.cota.replace(",", ".")) : null,
        volumen: row.volumen ? parseFloat(row.volumen.replace(",", ".")) : null,
        porcentaje: row.porcentaje ? parseFloat(row.porcentaje.replace(",", ".")) : null,
        timestamp: row.timestamp,
      })

      if (error) {
        console.error(`Error inserting data for ${row.nombre}:`, error)
      } else {
        console.log(`Successfully inserted data for ${row.nombre}`)
      }
    }
  } catch (error) {
    console.error("Scraping failed:", error)
    throw error
  } finally {
    await browser.close()
  }
}

// Main function
async function main() {
  try {
    console.log("Starting Guadiana scraping...")
    await scrapGuadiana()

    console.log("Process completed successfully")
  } catch (error) {
    console.error("Error in the process:", error)
  }
}

// Execute script
main()
