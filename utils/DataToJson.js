import formatFecha from "./FormatFecha.js"

function formatNombre(nombre) {
  if (nombre.includes(",")) {
    const partes = nombre.split(",").map((part) => part.trim())
    nombre = `${partes[1]} ${partes[0]}`.trim()
  }
  return nombre.replace("-(Pedrezuela)", "").trim()
}

export default function processDataToJSON(rows) {
  const encabezados = Object.keys(rows[0]).filter((header) => header !== "ELECTRICO_FLAG")
  encabezados.push("PORCENTAJE")
  const datos = []

  rows.forEach((row) => {
    const registro = {}
    encabezados.forEach((header) => {
      let valor = row[header] || ""
      if (header.toLowerCase().includes("fecha")) {
        valor
      }
      if (header.toLowerCase().includes("nombre")) {
        valor = formatNombre(valor)
      }
      registro[header] = valor
    })

    const col4 = parseInt(row[encabezados[3]]) || 0
    const col5 = parseInt(row[encabezados[4]]) || 0
    registro["PORCENTAJE"] = col5 !== 0 ? ((col5 / col4) * 100).toFixed(2) : "0.00"
    datos.push(registro)
  })

  const datosFiltrados = datos.filter((registro) => {
    const fechaKeys = Object.keys(registro).filter((key) =>
      key.toLowerCase().includes("fecha")
    )
    return fechaKeys.some((key) => {
      const year = new Date(registro[key]).getFullYear()
      return year > 2015
    })
  })

  return datosFiltrados
}
