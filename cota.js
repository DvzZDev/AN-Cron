import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

// Configuración inicial
dotenv.config()
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY no está definida en el archivo .env")
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Utilidades
const normalizarTexto = (texto) => {
  return texto.toLowerCase().trim()
}

// Función para actualizar datos en Supabase
async function actualizarSupabase(datosScraped) {
  try {
    const { data: cuencas, error: fetchError } = await supabase
      .from("datos_embalses")
      .select("*")
    if (fetchError) throw fetchError

    for (const cuenca of cuencas) {
      const resultado = datosScraped.find(
        (item) => item.nombre === cuenca.nombre_embalse.toLowerCase()
      )
      if (resultado) {
        const { error: updateError } = await supabase
          .from("datos_embalses")
          .update({ cota: resultado.cota })
          .eq("nombre_embalse", cuenca.nombre_embalse)
        if (updateError) throw updateError
      }
    }
  } catch (error) {
    console.error("Error actualizando Supabase:", error)
    throw error
  }
}

// Scraper Guadiana
async function scrapGuadiana() {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  try {
    await page.goto("https://www.saihguadiana.com/E/DATOS", { waitUntil: "networkidle" })

    return await page.$$eval("tr", (rows) => {
      return rows
        .map((row) => {
          const nombre = row.querySelector("td.mat-column-nombre")?.textContent.trim()
          const valor = row.querySelector("td.mat-column-NE1")?.textContent.trim()
          return nombre && valor
            ? {
                nombre: nombre.toLowerCase(),
                cota: valor.replace(",", "."),
              }
            : null
        })
        .filter(Boolean)
    })
  } finally {
    await browser.close()
  }
}

// Scraper Guadalquivir
async function scrapGuadalquivir() {
  const aliasMap = {
    "la torre del aguila": "torre del aguila",
    "la puebla de cazalla": "puebla de cazalla",
    "san rafael navallana": "san rafael de navallana",
    "el tranco de beas": "tranco de beas",
  }

  const browser = await chromium.launch()
  const page = await browser.newPage()

  try {
    await page.goto("https://www.chguadalquivir.es/saih/", { waitUntil: "networkidle" })
    await page.waitForSelector("table")

    const zones = await page.$$eval("#DDBzona option", (options) =>
      options.map((opt) => ({
        value: opt.value,
        text: opt.textContent.trim(),
      }))
    )

    const allData = []
    for (const zone of zones) {
      await page.selectOption("#DDBzona", zone.value)
      await page.waitForTimeout(2000)

      const zoneData = await page.$$eval(
        "tr",
        (rows, { aliasMap }) => {
          return rows
            .map((row) => {
              const embalse = row.querySelector(
                "td.filasGridView.align-middle.text-left"
              )?.textContent
              const nmn = row.querySelector(
                "td.filasGridView.align-middle:nth-of-type(2)"
              )?.textContent

              if (embalse && nmn) {
                let nombre = embalse.toLowerCase().trim().slice(3, -4).trim()
                nombre = aliasMap[nombre] || nombre
                return {
                  nombre,
                  cota: nmn.replace(",", "."),
                }
              }
              return null
            })
            .filter(Boolean)
        },
        { aliasMap }
      )

      allData.push(...zoneData)
    }

    return allData
  } finally {
    await browser.close()
  }
}

// Función principal
async function main() {
  try {
    console.log("Iniciando scraping de Guadiana...")
    const datosGuadiana = await scrapGuadiana()
    await actualizarSupabase(datosGuadiana)

    console.log("Iniciando scraping de Guadalquivir...")
    const datosGuadalquivir = await scrapGuadalquivir()
    await actualizarSupabase(datosGuadalquivir)

    console.log("Proceso completado exitosamente")
  } catch (error) {
    console.error("Error en el proceso:", error)
  }
}

// Ejecutar script
main()
