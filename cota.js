import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("supabaseKey is required.")
}

const supabase = createClient(supabaseUrl, supabaseKey)

;(async () => {
  console.log("Lanzando navegador...")
  const browser = await chromium.launch()
  const page = await browser.newPage()
  console.log("Navegando a la página...")
  await page.goto("https://www.saihguadiana.com/E/DATOS", { waitUntil: "networkidle" })

  console.log("Extrayendo datos...")
  const data = await page.$$eval("tr", (rows) => {
    return rows
      .map((row) => {
        const nombre = row.querySelector("td.mat-column-nombre")?.textContent.trim()
        const valor = row.querySelector("td.mat-column-NE1")?.textContent.trim()
        return nombre && valor ? { nombre: nombre.toLowerCase(), cota: valor } : null
      })
      .filter(Boolean)
  })

  try {
    console.log("Obteniendo datos de Supabase...")
    const { data: cuencas, error: fetchError } = await supabase
      .from("datos_embalses")
      .select("*")

    if (fetchError) throw fetchError

    console.log("Actualizando datos en Supabase...")
    for (const cuenca of cuencas) {
      const scrappingResult = data.find(
        (item) => item.nombre === cuenca.nombre_embalse.toLowerCase()
      )
      if (scrappingResult) {
        const { error: updateError } = await supabase
          .from("datos_embalses")
          .update({ cota: scrappingResult.cota.replace(",", ".") })
          .eq("nombre_embalse", cuenca.nombre_embalse)
        if (updateError) throw updateError
      }
    }
  } catch (error) {
    console.error("Error procesando datos:", error)
  }

  console.log("Cerrando navegador...")
  await browser.close()
  console.log("Script finalizado.")
})()
