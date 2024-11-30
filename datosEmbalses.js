import * as dotenv from "dotenv"
import * as cheerio from "cheerio"
import { format } from "date-fns"
import unidecode from "unidecode"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

// Supabase connection
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Main URL to scrape
const BASE_URL = "https://www.embalses.net"
const CUENCAS_URL = `${BASE_URL}/cuencas.php`

// Helper function to add delay between requests
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Fetch with error handling and retry mechanism
async function safeFetch(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      return await response.text()
    } catch (error) {
      if (attempt === retries) throw error
      await delay(1000 * attempt) // Exponential backoff
    }
  }
}

// Extract data from reservoir details page
function extractReservoirData($) {
  const divs = $("div.SeccionCentral_Caja")
  if (divs.length < 2) return null

  const second_div = $(divs[1])
  const fila_seccion_divs = second_div.find("div.FilaSeccion")

  const data = {
    agua_embalsada: null,
    agua_embalsadapor: null,
    variacion_ultima_semana: null,
    variacion_ultima_semanapor: null,
    capacidad_total: null,
    misma_semana_ultimo_año: null,
    misma_semana_ultimo_añopor: null,
    misma_semana_10años: null,
    misma_semana_10añospor: null,
  }

  fila_seccion_divs.each((k, fila_seccion_div) => {
    const fila_datos = []
    const resultado_divs = $(fila_seccion_div).find("div.Resultado")

    resultado_divs.each((_, resultado_div) => {
      const resultado = $(resultado_div).text().trim()
      fila_datos.push(resultado)
    })

    if (k === 0) {
      data.agua_embalsada = fila_datos[0]?.replace(".", "")
      data.agua_embalsadapor = fila_datos[1] || null
    } else if (k === 1) {
      data.variacion_ultima_semana = fila_datos[0]
      data.variacion_ultima_semanapor = fila_datos[1] || null
    } else if (k === 2) {
      data.capacidad_total = fila_datos[0]?.replace(".", "")
    } else if (k === 3) {
      data.misma_semana_ultimo_año = fila_datos[0]
      data.misma_semana_ultimo_añopor = fila_datos[1] || null
    } else if (k === 4) {
      data.misma_semana_10años = fila_datos[0]
      data.misma_semana_10añospor = fila_datos[1] || null
    }
  })

  return data
}

// Main scraping function
async function scrapeReservoirs() {
  try {
    const cuencasHtml = await safeFetch(CUENCAS_URL)
    const $ = cheerio.load(cuencasHtml)
    const basinRows = $("tr.ResultadoCampo")

    for (let i = 0; i < basinRows.length; i++) {
      const row = $(basinRows[i])
      const columns = $("td", row)
      const cuenca = $(columns[0]).text().trim()
      const cuenca_link = $(columns[0]).find("a").attr("href")

      if (!cuenca_link) continue

      await delay(1000)

      try {
        const cuencaHtml = await safeFetch(`${BASE_URL}/${cuenca_link}`)
        const cuenca_$ = cheerio.load(cuencaHtml)
        const cuenca_rows = cuenca_$.root().find("tr.ResultadoCampo")

        for (let j = 0; j < cuenca_rows.length; j++) {
          const cuenca_row = $(cuenca_rows[j])
          const cuenca_columns = cuenca_row.find("td")

          if (cuenca_columns.length < 3) continue

          let embalse = $(cuenca_columns[0]).text().trim()
          embalse = unidecode(embalse.replace(" [+]", "").trim())
          const embalse_link = $(cuenca_columns[0]).find("a").attr("href")

          if (!embalse_link) continue

          await delay(1000)

          try {
            const embalseHtml = await safeFetch(`${BASE_URL}/${embalse_link}`)
            const embalse_$ = cheerio.load(embalseHtml)

            const reservoirData = extractReservoirData(embalse_$)

            if (reservoirData) {
              const fecha_modificacion = format(new Date(), "yyyy-MM-dd HH:mm:ss")

              const dataToInsert = {
                fecha_modificacion,
                nombre_embalse: embalse.toLowerCase(),
                nombre_cuenca: cuenca,
                agua_embalsada: reservoirData.agua_embalsada,
                agua_embalsadapor: reservoirData.agua_embalsadapor,
                variacion_ultima_semana: reservoirData.variacion_ultima_semana,
                variacion_ultima_semanapor: reservoirData.variacion_ultima_semanapor,
                capacidad_total: reservoirData.capacidad_total,
                misma_semana_ultimo_año: reservoirData.misma_semana_ultimo_año,
                misma_semana_ultimo_añopor: reservoirData.misma_semana_ultimo_añopor,
                misma_semana_10años: reservoirData.misma_semana_10años,
                misma_semana_10añospor: reservoirData.misma_semana_10añospor,
              }

              // Insert or update data in Supabase
              const { data, error } = await supabase
                .from("datos_embalses")
                .upsert([dataToInsert])

              if (error) {
                console.error(`Error inserting data for ${embalse}:`, error)
              } else {
                console.log(`Successfully inserted data for ${embalse}`)
              }
            } else {
              console.log(`No data extracted for reservoir ${embalse}`)
            }
          } catch (error) {
            console.error(`Error processing reservoir ${embalse}:`, error)
          }

          await delay(500)
        }
      } catch (error) {
        console.error(`Error processing basin ${cuenca}:`, error)
      }
    }
  } catch (error) {
    console.error("Main scraping error:", error)
  } finally {
    console.log("Scraping process completed.")
  }
}

// Run the scraper
scrapeReservoirs()
