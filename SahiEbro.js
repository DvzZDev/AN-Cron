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
    console.log("🌐 Navigating to SAIH Ebro website...")
    await page.goto(
      "https://www.saihebro.com/tiempo-real/mapa-embalses-HG-toda-la-cuenca",
      {
        waitUntil: "networkidle",
        timeout: 30000,
      }
    )
    console.log("✅ Page loaded")

    const zoneLinks = await page.$$eval(
      'g[style="transform: translate(260px, 140px) scale(0.385);"] a.seleccion-zona',
      (links) => links.map((link) => link.getAttribute("href"))
    )

    let zoneCount = 0
    for (const link of zoneLinks) {
      zoneCount++
      console.log(`\n🗺️  Processing Zone ${zoneCount}/${zoneLinks.length}`)
      try {
        await page.goto(`https://www.saihebro.com${link}`, {
          waitUntil: "networkidle",
          timeout: 30000,
        })

        const pageData = await page.$$eval("g.contenedor-cajetin", (containers) =>
          containers
            .map((container) => {
              const nameElement = container.querySelector("text")
              const name = nameElement
                ? nameElement.textContent.trim().split(" ").slice(1).join(" ")
                : null

              const dataBoxes = container.querySelectorAll(".senal-cajetin")

              let cota = null,
                volumen = null,
                porcentaje = null,
                timestamp = null

              const firstBoxTitle = dataBoxes[0]?.getAttribute("title") || ""
              timestamp = new Date().toISOString()

              dataBoxes.forEach((box, index) => {
                const textElement =
                  box.nextElementSibling?.tagName.toLowerCase() === "text"
                    ? box.nextElementSibling
                    : null
                const value = textElement?.textContent.trim()
                if (!value) return

                switch (index) {
                  case 0:
                    cota = value.replace(",", ".")
                    break
                  case 1:
                    volumen = value.replace(",", ".")
                    break
                  case 2:
                    porcentaje = value.replace(",", ".")
                    break
                }
              })

              return { embalse: name, cota, volumen, porcentaje, timestamp }
            })
            .filter((item) => item.embalse)
        )

        allData.push(...pageData)

        await page.goBack()
      } catch (error) {
        console.error(`❌ Error processing zone ${link}:`, error)
        continue
      }
    }
  } catch (error) {
    console.error("❌ Scraping failed:", error)
  } finally {
    await browser.close()
    console.log("🔒 Browser closed")
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

    const { error } = await supabase.from("live_data").insert({
      id: `${row.embalse}_${row.timestamp}`,
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
  }
  console.log(`✅ Successfully inserted ${insertCount} entries into the database.`)
}

async function main() {
  console.log("🎯 Starting Ebro scraping process...")
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
    console.error("\n💥 Error in the process:", error)
  } finally {
    console.timeEnd("Total execution time")
  }
}

main()
