import fs from "fs/promises"
import downloadPDF from "./utils/DownloadPDF.js"
import ProcessPdf from "./utils/ProcessPDF.js"
import { GoogleGenerativeAI } from "@google/generative-ai"
import dotenv from "dotenv"
import InsertData from "./utils/InsertDataSupabase.js"

dotenv.config()

const url =
  "https://apambiente.pt/sites/default/files/_SNIAMB_Agua/DRH/MonitorizacaoAvaliacao/BoletimAlbufeiras/Semanal.pdf"
const outputFile = "./semanal.pdf"
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" })

export async function Main() {
  try {
    await downloadPDF(url, outputFile)
    const rawText = await ProcessPdf(outputFile)

    if (!rawText) {
      throw new Error("No text content extracted from PDF")
    }

    console.log("Processing text content...")
    const result = await model.generateContent(
      `Convierte los siguientes datos en un objeto JSON válido (sin marcadores de formato markdown ni código) con estas propiedades. Responde SOLO con el JSON, sin texto adicional.:
       - Cuenca
       - Embalse
       - Uso
       - Capacidad_Total (convertir de dam3 a hm3)
       - Volumen_Llenado (convertir de dam3 a hm3)
       - VolumenPor 
       - VariacionPor
       
       Datos: ${rawText}`
    )

    const responseText = result.response
      .text()
      .replace(/```[a-z]*\n?|\n```/g, "")
      .trim()
    const jsonResponse = JSON.parse(responseText)
    await fs.writeFile("datosEmbalsesPt.json", JSON.stringify(jsonResponse, null, 2))
    console.log("JSON response saved to datosEmbalsesPt.json")
    try {
      for (const item of jsonResponse) {
        await InsertData(item)
        console.log(`${item.Embalse} inserted successfully`)
      }
    } catch (error) {
      console.error("Error inserting data:", error)
    }

    console.log("Process completed successfully")
  } catch (error) {
    console.error(`Error: ${error.message}`)
    if (error instanceof SyntaxError) {
      console.error("Failed to parse JSON response")
    }
    try {
      await fs.unlink(outputFile)
    } catch (e) {
      console.error(`Failed to delete file: ${e.message}`)
    }
    process.exit(1)
  }
}

Main()
