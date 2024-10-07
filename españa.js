import dotenv from "dotenv"
import axios from "axios"
import * as cheerio from "cheerio"
import { format } from "date-fns"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

// Conexión a la base de datos
const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// URL de la página web que queremos scrappear
const url = "https://www.embalses.net/"

// Realizamos la petición a la web

axios
  .get(url)
  .then(async (response) => {
    // Pasamos el contenido HTML de la web a un objeto Cheerio
    const $ = cheerio.load(response.data)

    // Seleccionar el segundo elemento con la clase 'Resultado'

    const res = $(".Resultado").eq(1).text().slice(0, 2)
    const date = format(new Date(), "dd-MM-yyyy HH:mm:ss")
    try {
      const { data, error } = await supabase
        .from("datos_españa")
        .upsert({ id: "esp", porcentaje_embalsado: res, fecha: date })
        .select()

      if (error) {
        throw error
      }

      console.log("Datos insertados:", data)
    } catch (error) {
      console.error("Error al insertar los datos:", error)
    }
  })
  .catch((error) => {
    console.error("Error al obtener los datos:", error)
  })
