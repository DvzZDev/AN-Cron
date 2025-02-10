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
    await page.goto(
      "https://www.saihebro.com/tiempo-real/mapa-embalses-HG-toda-la-cuenca",
      {
        waitUntil: "networkidle",
        timeout: 30000,
      }
    )

    const zoneLinks = await page.$$eval(
      'g[style="transform: translate(260px, 140px) scale(0.385);"] a.seleccion-zona',
      (links) => links.map((link) => link.getAttribute("href"))
    )

    for (const link of zoneLinks) {
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
        console.log(allData)

        await page.goBack()
      } catch (error) {
        console.error(`Error processing zone ${link}:`, error)
        continue
      }
    }
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
