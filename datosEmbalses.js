import * as dotenv from "dotenv"
import * as cheerio from "cheerio"
import { format } from "date-fns"
import unidecode from "unidecode"
import { createClient } from "@supabase/supabase-js"
import pLimit from "p-limit"

dotenv.config()

// Conexión a Supabase
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// URL principal para hacer scraping
const BASE_URL = "https://www.embalses.net"
const CUENCAS_URL = `${BASE_URL}/cuencas.php`

// Configuración de concurrencia y procesamiento
const MAX_CONCURRENT_BASINS = 5
const MAX_CONCURRENT_RESERVOIRS = 10
const BATCH_SIZE = 50 // Tamaño de lotes para inserción

// Configuración de logs
const Logger = {
  log: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
  error: (message, error) =>
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error),
  stats: {
    totalBasins: 0,
    processedBasins: 0,
    totalReservoirs: 0,
    processedReservoirs: 0,
    insertedReservoirs: 0,
    failedReservoirs: 0,
  },
}

// Función de retraso con jitter para prevenir sobrecarga
function delayWithJitter(baseDelay = 500) {
  const jitter = Math.random() * 300
  return new Promise((resolve) => setTimeout(resolve, baseDelay + jitter))
}

// Fetch mejorado con más robustez
async function safeFetch(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 segundos timeout

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        })

        clearTimeout(timeoutId)

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

        return await response.text()
      } catch (err) {
        clearTimeout(timeoutId)
        if (attempt === retries) throw err

        Logger.log(`Retry attempt ${attempt} for ${url}`)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    } catch (error) {
      Logger.error(`Fetch error for ${url}`, error)
      if (attempt === retries) throw error
    }
  }
}

// Extracción de datos de embalse
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

    const extractionMap = {
      0: () => {
        data.agua_embalsada = fila_datos[0]?.replace(".", "")
        data.agua_embalsadapor = fila_datos[1] || null
      },
      1: () => {
        data.variacion_ultima_semana = fila_datos[0]
        data.variacion_ultima_semanapor = fila_datos[1] || null
      },
      2: () => {
        data.capacidad_total = fila_datos[0]?.replace(".", "")
      },
      3: () => {
        data.misma_semana_ultimo_año = fila_datos[0]
        data.misma_semana_ultimo_añopor = fila_datos[1] || null
      },
      4: () => {
        data.misma_semana_10años = fila_datos[0]
        data.misma_semana_10añospor = fila_datos[1] || null
      },
    }

    extractionMap[k]?.()
  })

  return data
}

// Inserción por lotes con más control y logs
async function batchInsertReservoirData(reservoirDataBatch) {
  if (reservoirDataBatch.length === 0) return

  try {
    const { data, error } = await supabase
      .from("datos_embalses")
      .upsert(reservoirDataBatch, {
        onConflict: "nombre_embalse",
        ignoreDuplicates: false,
      })

    if (error) {
      Logger.error("Batch insert error:", error)
      Logger.log(`Failed to insert ${reservoirDataBatch.length} reservoir records`)
    } else {
      Logger.log(`Successfully inserted ${reservoirDataBatch.length} reservoir records`)
      Logger.stats.insertedReservoirs += reservoirDataBatch.length
    }
  } catch (error) {
    Logger.error("Batch insert failed:", error)
  }
}

// Función principal de scraping con control de flujo mejorado
async function scrapeReservoirs() {
  const startTime = Date.now()

  try {
    Logger.log("Iniciando proceso de scraping de embalses...")

    const cuencasHtml = await safeFetch(CUENCAS_URL)
    const $ = cheerio.load(cuencasHtml)
    const basinRows = $("tr.ResultadoCampo")

    Logger.stats.totalBasins = basinRows.length
    Logger.log(`Total de cuencas encontradas: ${basinRows.length}`)

    const allReservoirData = []
    const limitBasins = pLimit(MAX_CONCURRENT_BASINS)

    const basinRowsArray = basinRows.toArray()

    // Procesar cuencas en paralelo con límite
    await Promise.all(
      basinRowsArray.map((basinRow) =>
        limitBasins(async () => {
          const row = $(basinRow)
          const columns = $("td", row)
          const cuenca = $(columns[0]).text().trim()
          const cuenca_link = $(columns[0]).find("a").attr("href")

          if (!cuenca_link) return

          Logger.log(`Procesando cuenca: ${cuenca}`)
          Logger.stats.processedBasins++

          try {
            const cuencaHtml = await safeFetch(`${BASE_URL}/${cuenca_link}`)
            const cuenca_$ = cheerio.load(cuencaHtml)
            const cuenca_rows = cuenca_$.root().find("tr.ResultadoCampo")
            Logger.stats.totalReservoirs += cuenca_rows.length
            Logger.log(`Embalses en ${cuenca}: ${cuenca_rows.length}`)

            const limitReservoirs = pLimit(MAX_CONCURRENT_RESERVOIRS)
            const cuencaRowsArray = cuenca_rows.toArray()

            // Procesar embalses en paralelo con límite
            await Promise.all(
              cuencaRowsArray.map((cuenca_row) =>
                limitReservoirs(async () => {
                  const cuenca_columns = $(cuenca_row).find("td")

                  if (cuenca_columns.length < 3) return

                  let embalse = $(cuenca_columns[0]).text().trim()
                  embalse = unidecode(embalse.replace(" [+]", "").trim())
                  const embalse_link = $(cuenca_columns[0]).find("a").attr("href")

                  if (!embalse_link) return

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
                        ...reservoirData,
                      }
                      Logger.log(`Insertando datos del embalse: ${embalse}`)

                      allReservoirData.push(dataToInsert)
                      Logger.stats.processedReservoirs++

                      // Insertar en lotes
                      if (allReservoirData.length >= BATCH_SIZE) {
                        await batchInsertReservoirData(
                          allReservoirData.splice(0, BATCH_SIZE)
                        )
                      }
                    }
                  } catch (error) {
                    Logger.error(`Error procesando embalse ${embalse}`, error)
                    Logger.stats.failedReservoirs++
                  }

                  // Pausa para no sobrecargar el servidor
                  await delayWithJitter()
                })
              )
            )
          } catch (error) {
            Logger.error(`Error procesando cuenca ${cuenca}`, error)
          }
        })
      )
    )

    // Insertar cualquier dato restante
    if (allReservoirData.length > 0) {
      await batchInsertReservoirData(allReservoirData)
    }
  } catch (error) {
    Logger.error("Error principal en el scraping", error)
  } finally {
    const endTime = Date.now()
    Logger.log("Resumen del proceso:")
    Logger.log(`Tiempo total: ${(endTime - startTime) / 1000} segundos`)
    Logger.log(`Cuencas totales: ${Logger.stats.totalBasins}`)
    Logger.log(`Cuencas procesadas: ${Logger.stats.processedBasins}`)
    Logger.log(`Embalses totales: ${Logger.stats.totalReservoirs}`)
    Logger.log(`Embalses procesados: ${Logger.stats.processedReservoirs}`)
    Logger.log(`Embalses insertados: ${Logger.stats.insertedReservoirs}`)
    Logger.log(`Embalses con error: ${Logger.stats.failedReservoirs}`)
    Logger.log("Proceso de scraping completado.")
  }
}

// Ejecutar el scraper
scrapeReservoirs()
