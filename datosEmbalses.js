import dotenv from "dotenv"
import axios from "axios"
import * as cheerio from "cheerio"
import { format } from "date-fns"
import unidecode from "unidecode"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

// Conexión a la base de datos
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// URL de la página web que queremos scrappear
const url = "https://www.embalses.net/cuencas.php"

// Función para agregar un retraso
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Realizamos la petición a la web
axios
  .get(url)
  .then(async (response) => {
    // Pasamos el contenido HTML de la web a un objeto Cheerio
    const $ = cheerio.load(response.data)

    // Obtenemos la tabla donde están los datos
    const table = $("table.Tabla")

    // Recorremos todas las filas de la tabla para extraer los datos
    $("tr.ResultadoCampo", table).each(async (_, row) => {
      const columns = $("td", row)
      const cuenca = $(columns[0]).text().trim()
      const cuenca_link = $(columns[0]).find("a").attr("href")

      await delay(1000) // Agregar un retraso de 1 segundo entre solicitudes

      try {
        const cuenca_response = await axios.get(`https://www.embalses.net/${cuenca_link}`)
        const cuenca_soup = cheerio.load(cuenca_response.data)

        const cuenca_table = cuenca_soup("table.Tabla")
        const cuenca_rows = cuenca_table.find("tr.ResultadoCampo")

        for (let j = 0; j < cuenca_rows.length; j++) {
          const cuenca_row = $(cuenca_rows[j])
          const cuenca_columns = cuenca_row.find("td")
          if (cuenca_columns.length >= 3) {
            let embalse = $(cuenca_columns[0]).text().trim()
            embalse = unidecode(embalse.replace(" [+]", "").trim())
            const embalse_link = $(cuenca_columns[0]).find("a").attr("href")

            console.log(`Embalse: ${embalse} | Cuenca: ${cuenca}`)

            await delay(1000) // Agregar un retraso de 1 segundo entre solicitudes

            try {
              const embalse_response = await axios.get(
                `https://www.embalses.net/${embalse_link}`
              )
              const embalse_soup = cheerio.load(embalse_response.data)

              const divs = embalse_soup("div.SeccionCentral_Caja")

              if (divs.length < 2) {
                console.log(
                  `No se encontraron al menos dos divs con la clase 'SeccionCentral_Caja' en el embalse ${embalse}`
                )
              } else {
                const second_div = $(divs[1])

                const fila_seccion_divs = second_div.find("div.FilaSeccion")

                let agua_embalsada,
                  agua_embalsada_por,
                  variacion_ultima_semana,
                  variacion_ultima_semana_por,
                  capacidad_total,
                  misma_semana_ultimo_año,
                  misma_semana_ultimo_año_por,
                  misma_semana_10años,
                  misma_semana_10años_por

                fila_seccion_divs.each((k, fila_seccion_div) => {
                  const fila_datos = []
                  const resultado_divs = $(fila_seccion_div).find("div.Resultado")

                  resultado_divs.each((_, resultado_div) => {
                    const resultado = $(resultado_div).text().trim()
                    fila_datos.push(resultado)
                  })

                  if (k === 0) {
                    agua_embalsada = fila_datos[0].replace(".", "")
                    agua_embalsada_por = fila_datos.length > 1 ? fila_datos[1] : null
                  } else if (k === 1) {
                    variacion_ultima_semana = fila_datos[0]
                    variacion_ultima_semana_por =
                      fila_datos.length > 1 ? fila_datos[1] : null
                  } else if (k === 2) {
                    capacidad_total = fila_datos[0].replace(".", "")
                  } else if (k === 3) {
                    misma_semana_ultimo_año = fila_datos[0]
                    misma_semana_ultimo_año_por =
                      fila_datos.length > 1 ? fila_datos[1] : null
                  } else if (k === 4) {
                    misma_semana_10años = fila_datos[0]
                    misma_semana_10años_por = fila_datos.length > 1 ? fila_datos[1] : null
                  }
                })

                const fecha_modificacion = format(new Date(), "yyyy-MM-dd HH:mm:ss")

                // Insertamos los datos en la base de datos
                const { data, error } = await supabase.from("datos_embalses").upsert([
                  {
                    fecha_modificacion,
                    nombre_embalse: embalse.toLowerCase(),
                    nombre_cuenca: cuenca,
                    agua_embalsada,
                    agua_embalsadapor: agua_embalsada_por,
                    variacion_ultima_semana,
                    variacion_ultima_semanapor: variacion_ultima_semana_por,
                    capacidad_total,
                    misma_semana_ultimo_año,
                    misma_semana_ultimo_añopor: misma_semana_ultimo_año_por,
                    misma_semana_10años,
                    misma_semana_10añospor: misma_semana_10años_por,
                  },
                ])

                if (error) {
                  console.error("Error inserting data:", error)
                } else {
                  console.log("Data inserted successfully:", data)
                }
              }
            } catch (error) {
              console.error(`Error fetching embalse data for ${embalse}:`, error)
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching cuenca data for ${cuenca}:`, error)
      }
    })
  })
  .catch((error) => {
    console.error("Error fetching data:", error)
  })
