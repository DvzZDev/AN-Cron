import dotenv from "dotenv"
import { format } from "date-fns"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const fecha_modificacion = format(new Date(), "yyyy-MM-dd HH:mm:ss")

export default async function InsertInDb(item) {
  try {
    const { data: insertData, error } = await supabase.from("portugal_data").upsert(
      [
        {
          fecha_modificacion,
          nombre_cuenca:
            item.Cuenca.charAt(0).toUpperCase() + item.Cuenca.slice(1).toLowerCase(),
          nombre_embalse: item.Embalse.toLowerCase(),
          agua_embalsada: item.Volumen_Llenado.toFixed(0),
          agua_embalsadapor: item.VolumenPor.replace("%", ""),
          variacion_ultima_semanapor: item.VariacionPor.replace("%", ""),
          variacion_ultima_semana: (
            (item.Capacidad_Total * parseFloat(item.VariacionPor.replace("%", ""))) /
            100
          ).toFixed(0),
          pais: "Portugal",
          capacidad_total: item.Capacidad_Total.toFixed(0),
        },
      ],
      {
        onConflict: ["nombre_embalse"],
        updateColumns: [
          "fecha_modificacion",
          "nombre_cuenca",
          "agua_embalsada",
          "agua_embalsadapor",
          "variacion_ultima_semanapor",
          "variacion_ultima_semana",
          "capacidad_total",
        ],
      }
    )

    if (error) {
      console.error("Error inserting data:", error)
    } else {
      console.log("Data inserted successfully:", insertData)
    }
  } catch (error) {
    console.error("Error in InsertInDb:", error)
  }
}
