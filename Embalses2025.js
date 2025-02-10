import AdmZip from "adm-zip"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import MDBReader from "mdb-reader"
import insertData from "./utils/InsertData2025.js"
import processDataToJSON from "./utils/DataToJson.js"

const url =
  "https://www.miteco.gob.es/content/dam/miteco/es/agua/temas/evaluacion-de-los-recursos-hidricos/boletin-hidrologico/Historico-de-embalses/BD-Embalses.zip"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const downloadPath = path.join(__dirname, "BD-Embalses.zip")
const extractPath = path.join(__dirname, "DB")
const accessDbPath = path.join(extractPath, "BD-Embalses.mdb")

async function downloadFile(url, outputPath) {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  fs.writeFileSync(outputPath, buffer)
  console.log("Archivo descargado con éxito:", outputPath)
}

function extractZip(filePath, outputDir) {
  const zip = new AdmZip(filePath)
  zip.extractAllTo(outputDir, true)
  console.log("Archivo descomprimido en:", outputDir)
}

function getTableName() {
  return new Promise((resolve, reject) => {
    try {
      const buffer = fs.readFileSync(accessDbPath)
      const reader = new MDBReader(buffer)
      const tables = reader.getTableNames()
      resolve(tables[0])
    } catch (err) {
      reject(`Error reading database: ${err.message}`)
    }
  })
}

function readAccessDb(tableName) {
  return new Promise((resolve, reject) => {
    try {
      const buffer = fs.readFileSync(accessDbPath)
      const reader = new MDBReader(buffer)
      const table = reader.getTable(tableName)
      const rows = table.getData()
      resolve(rows)
    } catch (err) {
      reject(`Error reading database: ${err.message}`)
    }
  })
}

async function downloadAndProcessData() {
  try {
    console.log("Inicio de downloadAndProcessData")

    console.log("Iniciando descarga...")
    await downloadFile(url, downloadPath)

    console.log("Descomprimiendo archivo...")
    extractZip(downloadPath, extractPath)

    console.log("Obteniendo el nombre de la tabla...")
    const tableName = await getTableName()

    console.log("Leyendo datos de la base de datos Access...")
    const rows = await readAccessDb(tableName)
    console.log("Transformando datos a JSON")
    const datosJSON = processDataToJSON(rows)
    console.log("Insertando datos")
    await insertData(datosJSON)
  } catch (error) {
    console.error("Error en downloadAndProcessData:", error)
  }
}

downloadAndProcessData()
