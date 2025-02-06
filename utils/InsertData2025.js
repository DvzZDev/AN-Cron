import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

export default async function insertData(data) {
  const BATCH_SIZE = 1000
  let successCount = 0
  let errorCount = 0

  const chunks = []
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    chunks.push(data.slice(i, i + BATCH_SIZE))
  }

  await Promise.all(
    chunks.map(async (chunk, index) => {
      try {
        const formattedData = chunk.map((d) => ({
          embalse: d.EMBALSE_NOMBRE,
          cuenca: d.AMBITO_NOMBRE,
          fecha: new Date(d.FECHA),
          capacidad_total: parseFloat(d.AGUA_TOTAL.replace(",", ".")),
          volumen_actual: parseFloat(d.AGUA_ACTUAL.replace(",", ".")),
          porcentaje: parseFloat(d.PORCENTAJE),
        }))

        const { data: insertedData, error } = await supabase
          .from("embalses2025")
          .upsert(formattedData)

        if (error) {
          errorCount += chunk.length
          console.error(`Error in chunk ${index}:`, error)
        } else {
          successCount += chunk.length
          console.log(`✅ Chunk ${index}: ${chunk.length} records processed`)
        }
      } catch (error) {
        errorCount += chunk.length
        console.error(`⚠️ Error processing chunk ${index}:`, error)
      }
    })
  )

  console.log(`\nInsert Summary:`)
  console.log(`✅ Successfully inserted: ${successCount}`)
  console.log(`❌ Errors: ${errorCount}`)
}
