export default function formatFecha(fecha) {
  try {
    // Handle Date object
    if (fecha instanceof Date) {
      const dia = fecha.getDate().toString().padStart(2, "0")
      const mes = (fecha.getMonth() + 1).toString().padStart(2, "0")
      const anio = fecha.getFullYear()
      return `${dia}/${mes}/${anio}`
    }

    // Handle string input
    if (typeof fecha === "string") {
      fecha = fecha.replace(/"/g, "").trim()
      // Check if it's a full datetime string
      if (fecha.includes("GMT")) {
        return formatFecha(new Date(fecha))
      }
      const [fechaPart] = fecha.split(" ")
      const [mes, dia, anio] = fechaPart.split("/")
      const anioNum = parseInt(anio)
      const anioCompleto = anioNum < 50 ? 2000 + anioNum : 1900 + anioNum
      const mesFormateado = mes.padStart(2, "0")
      const diaFormateado = dia.padStart(2, "0")
      return `${diaFormateado}/${mesFormateado}/${anioCompleto}`
    }

    // Return original value if neither Date nor string
    return fecha
  } catch (error) {
    console.error(`Error procesando fecha '${fecha}':`, error.message)
    return fecha
  }
}
