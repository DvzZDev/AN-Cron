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
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  const page = await browser.newPage()
  const allData = []

  try {
    await page.goto("https://saihweb.chsegura.es/apps/iVisor/embalses3.php", {
      waitUntil: "networkidle",
    })
    console.log("Page loaded")
    await page.waitForSelector("#historico > div:nth-child(4) > div:nth-child(2)")
    console.log("Data loaded")
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
    console.error("Scraping failed:", error)
  } finally {
    await browser.close()
  }

  return allData
}

async function FuzzData(data) {
  const manualOverrides = {
    "la estanca": "Alcañiz (Estanca)",
    "puente santolea": "Puente de Santolea",
    "cañon-santolea": "Cañón de Santolea",
    "aranda-maidevera": "Maidevera",
    val: 0,
  }

  const processedNames = new Set()

  return data.reduce((acc, item) => {
    if (item.embalse === 0) {
      return acc
    }

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
    console.log("Starting Ebro scraping...")
    let AllData = await scrapEbro()
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
