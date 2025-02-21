import dotenv from "dotenv"
import axios from "axios"
import * as cheerio from "cheerio"
import { format } from "date-fns"
import unidecode from "unidecode"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const url = "https://www.embalses.net/cuencas.php"


axios
  .get(url)
  .then((response) => {
    const $ = cheerio.load(response.data)

    const table = $("table.Tabla")

    $("tr.ResultadoCampo", table).each(async (_, row) => {
      const columns = $("td", row)
      const cuenca = unidecode($(columns[0]).text().trim().replace(" ", "_"))
      const capacidad = $(columns[1]).text().trim()
      const embalsada = $(columns[2]).text().trim()
      const porcentaje_embalsada = parseFloat(
        $(columns[3]).text().trim().replace("(", "").replace(")", "").replace("%", "")
      )
      const variacion = $(columns[4]).text().trim()
      const porcentaje_variacion = parseFloat(
        $(columns[5]).text().trim().replace("(", "").replace(")", "").replace("%", "")
      )
      const fecha_modificacion = format(new Date(), "yyyy-MM-dd HH:mm:ss")

      const { data, error } = await supabase.from("datos_cuencas").upsert([
        {
          cuenca,
          capacidad,
          embalsada,
          porcentaje_embalsada,
          variacion,
          porcentaje_variacion,
          fecha_modificacion,
        },
      ])

      if (error) {
        console.error("Error inserting data:", error)
      } else {
        console.log("Data inserted successfully:", data)
      }
    })
  })
  .catch((error) => {
    console.error("Error fetching data:", error)
  })
