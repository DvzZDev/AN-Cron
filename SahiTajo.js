import dotenv from "dotenv"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { fuzzy } from "fast-fuzzy"
import names from "./names.json" assert { type: "json" }

dotenv.config()

const supabaseUrl = "https://rxxyplqherusqxdcowgh.supabase.co"
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is not defined in the .env file")
}

const supabase = createClient(supabaseUrl, supabaseKey)

function encontrarMejorCoincidencia(nombreScraped, nombresCorrectos) {
  let mejorPuntaje = -Infinity
  let mejorCoincidencia = nombreScraped

  for (const nombreCorrecto of nombresCorrectos) {
    const puntaje = fuzzy(nombreScraped, nombreCorrecto, {
      ignoreCase: true,
      normalize: true,
    })

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejorCoincidencia = nombreCorrecto
    }
  }

  return { nombre: mejorCoincidencia, puntaje: mejorPuntaje }
}

async function scrapTajo() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  })

  const page = await context.newPage()
  const MAX_RETRIES = 3
  let AllData = []
  const processedEmbalses = new Set()

  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await page.goto("https://saihtajo.chtajo.es/index.php#nav", {
          waitUntil: "networkidle",
          timeout: 30000,
        })

        const datosTiempoRealButtonSelector =
          'ons-toolbar-button.toolbar-button[href*="get-datos-tiempo-real"]'
        await page.waitForSelector(datosTiempoRealButtonSelector, {
          timeout: 120000,
          state: "visible",
        })
        const datosTiempoRealButton = await page.$(datosTiempoRealButtonSelector)
        if (datosTiempoRealButton) {
          await datosTiempoRealButton.click({ force: true })
          await page.waitForTimeout(1000)
          await page.waitForLoadState("networkidle")
        }

        const tipologiasButtonXPath =
          '//ons-tab[@label="Tipologías"]//button[contains(@class, "tabbar__button")]'
        await page.waitForSelector(tipologiasButtonXPath, {
          state: "visible",
          timeout: 15000,
        })
        const tipologiasButton = await page.$(tipologiasButtonXPath)
        if (tipologiasButton) {
          await tipologiasButton.click({ force: true })
        }

        const embButton =
          "#tabbar-datos-tiempo-real > div.tabbar__content.ons-tabbar__content.ons-swiper.tabbar--top__content > div.ons-swiper-target.active > ons-page:nth-child(3) > div.page__content > ons-list > ons-list-item:nth-child(4)"
        await page.waitForSelector(embButton, { state: "visible", timeout: 15000 })
        const regions = await page.$$(embButton)

        for (const region of regions) {
          await region.click({ force: true })
          await page.waitForTimeout(1000)

          const firstExpandableSelector =
            "#tabbar-datos-tiempo-real > div.tabbar__content.ons-tabbar__content.ons-swiper.tabbar--top__content > div.ons-swiper-target.active > ons-page:nth-child(3) > div.page__content > ons-list > ons-list-item.list-item.list-item--expandable.list-item--expanded > div.expandable-content.list-item__expandable-content"
          await page.waitForSelector(firstExpandableSelector, {
            state: "visible",
            timeout: 15000,
          })

          const expandableItems = await page.$$(
            firstExpandableSelector + " > ons-list-item"
          )
          for (const item of expandableItems) {
            await item.click({ force: true })
            await page.waitForTimeout(1000)

            const nestedExpandableSelector =
              firstExpandableSelector +
              " > ons-list-item.list-item.list-item--expandable.list-item--expanded > div.expandable-content.list-item__expandable-content"
            await page.waitForSelector(nestedExpandableSelector, {
              state: "visible",
              timeout: 15000,
            })

            const embalseSelector = nestedExpandableSelector + " > ons-list-item"
            const embalses = await page.$$(embalseSelector)

            for (let i = 0; i < embalses.length; i++) {
              const embalse = embalses[i]
              const embalseName = await embalse.$eval(
                ".center.list-item__center",
                (node) => node.innerText.trim()
              )

              if (processedEmbalses.has(embalseName)) {
                console.warn(`Skipping duplicate embalse: ${embalseName}`)
                continue
              }

              await embalse.scrollIntoViewIfNeeded()
              await embalse.click({ force: true })
              await page.waitForTimeout(1000)

              try {
                const [cotaValue, volumenValue, porcentajeValue] = await page.evaluate(
                  () => {
                    const getMetricValue = (titleText) => {
                      const containers = document.querySelectorAll(
                        ".center.list-item__center"
                      )
                      for (const container of containers) {
                        const titulo = container.querySelector(
                          ".titulo-metrica-estacion .titulo"
                        )
                        if (titulo && titulo.textContent.includes(titleText)) {
                          const destacado = container.querySelector(
                            ".dato-metrica-estacion.destacada"
                          )
                          if (destacado) {
                            const textNode =
                              destacado.querySelector("span.label").nextSibling
                            return textNode.nodeValue.trim()
                          }
                        }
                      }
                      return null
                    }
                    return [
                      getMetricValue("COTA EMBALSE"),
                      getMetricValue("VOLUMEN"),
                      getMetricValue("VOLUMEN PORCENTUAL"),
                    ]
                  }
                )

                const scrapedEmbalseName = await page.$eval(
                  ".titulo-tarjeta-estacion",
                  (node) => node.innerText
                )

                if (!processedEmbalses.has(embalseName)) {
                  AllData.push({
                    embalse: scrapedEmbalseName.split("-").slice(1).join("-").trim(),
                    volumen: volumenValue,
                    porcentaje: porcentajeValue,
                    cota: cotaValue,
                    timestamp: new Date().toISOString(),
                  })
                  processedEmbalses.add(embalseName)
                  console.log("Done for embalse: ", embalseName)
                } else {
                  console.warn(`Duplicate embalse found: ${embalseName}`)
                }
              } catch (error) {
                console.warn(`No metric found for this embalse: ${embalseName}`)
                console.log(error.message)
              }
              const closeButtonSelector = "#cerrar-dialog-estacion"
              await page.waitForSelector(closeButtonSelector, {
                state: "visible",
                timeout: 15000,
              })
              await page.click(closeButtonSelector, { force: true })
              await page.waitForTimeout(1000)
            }
          }
        }

        break
      } catch (error) {
        console.warn(`Attempt ${attempt} failed:`, error)
        if (attempt === MAX_RETRIES) {
          console.error("Max retries reached. Scraping failed.")
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
    return AllData
  } catch (error) {
    console.error("Scraping failed:", error)
  } finally {
    await browser.close()
  }
}

async function FuzzData(data) {
  const manualOverrides = {
    burguillo: "Burguillo",
    "guadiloba - caceres": "Cáceres - Guadiloba",
  }

  return data.reduce((acc, item) => {
    if (item.embalse === 0) {
      return acc
    }

    let matchedName = item.embalse.toLowerCase()

    if (manualOverrides.hasOwnProperty(matchedName)) {
      const overrideName = manualOverrides[matchedName]
      matchedName = overrideName
      acc.push({ ...item, embalse: matchedName })
    } else {
      const { nombre, puntaje } = encontrarMejorCoincidencia(
        item.embalse.toLowerCase(),
        names
      )
      if (puntaje >= 0.9) {
        acc.push({ ...item, embalse: nombre })
      }
    }
    return acc
  }, [])
}

async function InsertData(data) {
  console.log(data)
  for (const row of data) {
    if (!row.embalse) continue

    console.log(`Processing ${row.embalse}...`)

    const { error } = await supabase.from("live_data").insert({
      id: `${row.embalse}_${new Date().toISOString()}`,
      embalse: row.embalse,
      cota: row.cota ? parseFloat(row.cota.replace(",", ".")) : null,
      volumen: row.volumen ? parseFloat(row.volumen.replace(",", ".")) : null,
      porcentaje: row.porcentaje ? parseFloat(row.porcentaje.replace(",", ".")) : null,
      timestamp: row.timestamp,
    })

    if (error) {
      console.error(`Error inserting data for ${row.nombre}:`, error)
    } else {
      console.log(`Successfully inserted data for ${row.nombre}`)
    }
  }
}

async function main() {
  try {
    console.log("Starting Tajo scraping...")
    let AllData = await scrapTajo()
    console.log("Applying fuzzy matching...")
    AllData = await FuzzData(AllData)
    const data = await FuzzData(AllData)
    console.log("Inserting data...")
    await InsertData(data)
    console.log("Process completed successfully")
  } catch (error) {
    console.error("Error in the process:", error)
  }
}

main()
