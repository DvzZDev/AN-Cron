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
  const { error } = await supabase.from("live_data").insert(
    data.map((item) => ({
      id: `${item.nombre}_${new Date().toISOString()}`,
      embalse: item.nombre,
      cota: item.cota,
      volumen: item.volumen,
      porcentaje: item.porcentaje,
      timestamp: item.timestamp,
    }))
  )

  if (error) {
    console.error("Error inserting data:", error.message)
  }
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
  const browser = await chromium.launch()
  const page = await browser.newPage()

  try {
    await page.goto("https://www.chguadalquivir.es/saih/EmbalNiv.aspx", {
      waitUntil: "networkidle",
    })
    await page.waitForSelector("table")

    const zones = await page.$$eval("#DDBzona option", (options) =>
      options.map((opt) => ({
        value: opt.value,
        text: opt.textContent.trim(),
      }))
    )

    let allData = []

    for (const zone of zones) {
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
    allData = allData.map((item) => {
      const { nombre, puntaje } = encontrarMejorCoincidencia(
        item.nombre.toLowerCase(),
        nombres
      )
      return {
        ...item,
        nombre: nombre,
      }
    })

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
  } finally {
    await browser.close()
  }
}

async function main() {
  try {
    console.log("Starting Guadalquivir scraping...")
    const datosGuadalquivir = await scrapGuadalquivir()
    console.log("Processed data:", datosGuadalquivir)
    console.log("Inserting data into Supabase...")
    await insertData(datosGuadalquivir)
    console.log("Process completed successfully")
  } catch (error) {
    console.error("Error in the process:", error)
  }
}

main()
