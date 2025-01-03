import fs from "fs"
import pdfParse from "pdf-parse/lib/pdf-parse.js"

export default async function extractPagesFromPDF(pdfPath) {
  try {
    const pdfBuffer = await fs.promises.readFile(pdfPath)
    const options = {
      max: 8,
      pagerender: render_page,
    }

    let extractedData = ""

    function render_page(pageData) {
      const pageNumber = pageData.pageNumber
      if (pageNumber >= 7 && pageNumber <= 8) {
        return pageData.getTextContent().then(function (textContent) {
          let pageText = ""
          textContent.items.forEach(function (item) {
            pageText += item.str + " "
          })
          extractedData += pageText
          return pageText
        })
      }
      return Promise.resolve("")
    }

    await pdfParse(pdfBuffer, options)
    return extractedData.trim()
  } catch (error) {
    console.error(`Error al procesar el PDF: ${error.message}`)
    throw error
  }
}
