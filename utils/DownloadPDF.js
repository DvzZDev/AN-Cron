import fs from "fs"
import { Readable } from "node:stream"

export default async function downloadPDF(url, outputFile) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Error al descargar el archivo: ${response.status} ${response.statusText}`
      )
    }

    const nodeStream = Readable.from(response.body)
    const fileStream = fs.createWriteStream(outputFile)

    await new Promise((resolve, reject) => {
      nodeStream.pipe(fileStream)
      nodeStream.on("error", reject)
      fileStream.on("finish", resolve)
    })

    console.log("Archivo descargado con éxito")
  } catch (error) {
    throw new Error(`Error downloading PDF: ${error.message}`)
  }
}
