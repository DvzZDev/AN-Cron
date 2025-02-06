import embalses from "./embalses_data.json" assert { type: "json" }
import fs from "fs"
export function GetEmbalses() {
  let Nombres = []
  const embalsesNames = embalses.forEach((embalse) => {
    if (!Nombres.includes(embalse.EMBALSE_NOMBRE)) {
      Nombres.push(embalse.EMBALSE_NOMBRE)
    }
  })
  console.log(Nombres)
  return Nombres
}

export function AllJson(data) {
  fs.writeFileSync("names.json", JSON.stringify(data))
}

GetEmbalses()
AllJson(GetEmbalses())
