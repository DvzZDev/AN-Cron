import get from "axios";
import { load } from "cheerio";
import { createConnection } from "mysql2/promise";
import { configure, getLogger } from "log4js";

async function main() {
  const fecha_modificacion = new Date().toISOString().slice(0, 19).replace("T", " ");

  const conn = await createConnection({
    host: "gateway01.eu-central-1.prod.aws.tidbcloud.com",
    port: 4000,
    user: "DfWYA9vQa8C3KYP.root",
    password: "bITJL8OzxMkIstMi",
    database: "CuencasHidrograficas",
    ssl: {
      rejectUnauthorized: process.env.ssl_rejectUnauthorized,
    },
  });

  const cursor = conn.connection;

  const url = "https://www.embalses.net/cuencas.php";

  const response = await get(url);

  const $ = load(response.data);

  const table = $("table.Tabla");

  const rows = table.find("tr.ResultadoCampo");

  for (let i = 0; i < rows.length; i++) {
    const row = $(rows[i]);
    const columns = row.find("td");
    const cuenca = $(columns[0]).text().trim();
    const cuenca_link = $(columns[0]).find("a").attr("href");

    const cuenca_response = await get(`https://www.embalses.net/${cuenca_link}`);
    const cuenca_soup = load(cuenca_response.data);

    const cuenca_table = cuenca_soup("table.Tabla");
    const cuenca_rows = cuenca_table.find("tr.ResultadoCampo");

    for (let j = 0; j < cuenca_rows.length; j++) {
      const cuenca_row = $(cuenca_rows[j]);
      const cuenca_columns = cuenca_row.find("td");
      if (cuenca_columns.length >= 3) {
        let embalse = $(cuenca_columns[0]).text().trim();
        embalse = embalse.replace("Ã±", "ñ").replace("[+]", "");
        const embalse_link = $(cuenca_columns[0]).find("a").attr("href");

        console.log(`Embalse: ${embalse} | Cuenca: ${cuenca}`);

        const embalse_response = await get(`https://www.embalses.net/${embalse_link}`);
        const embalse_soup = load(embalse_response.data);

        const divs = embalse_soup("div.SeccionCentral_Caja");

        if (divs.length < 2) {
          console.log(
            `No se encontraron al menos dos divs con la clase 'SeccionCentral_Caja' en el embalse ${embalse}`
          );
        } else {
          const second_div = $(divs[1]);

          const fila_seccion_divs = second_div.find("div.FilaSeccion");

          configure({
            appenders: { file: { type: "file", filename: "app.log" } },
            categories: { default: { appenders: ["file"], level: "info" } },
          });

          const logger = getLogger();

          for (let k = 0; k < fila_seccion_divs.length; k++) {
            const fila_seccion_div = $(fila_seccion_divs[k]);
            const campo_div = fila_seccion_div.find("div.Campo");
            const resultado_divs = fila_seccion_div.find("div.Resultado");
            const unidad_divs = fila_seccion_div.find("div.Unidad, div.Unidad2");

            if (campo_div.length && resultado_divs.length && unidad_divs.length) {
              const fila_datos = [];
              for (let l = 0; l < resultado_divs.length; l++) {
                const resultado = $(resultado_divs[l]).text().trim();
                fila_datos.push(resultado);
              }

              if (k === 0) {
                var agua_embalsada = fila_datos[0].replace(".", "");
                var agua_embalsada_por = fila_datos.length > 1 ? fila_datos[1] : null;
                logger.info(
                  `Iteración ${k}: agua_embalsada = ${agua_embalsada}, agua_embalsada_por = ${agua_embalsada_por}`
                );
              } else if (k === 1) {
                var variacion_ultima_semana = fila_datos[0];
                var variacion_ultima_semana_por =
                  fila_datos.length > 1 ? fila_datos[1] : null;
                logger.info(
                  `Iteración ${k}: variacion_ultima_semana = ${variacion_ultima_semana}, variacion_ultima_semana_por = ${variacion_ultima_semana_por}`
                );
              } else if (k === 2) {
                var capacidad_total = fila_datos[0].replace(".", "");
                logger.info(`Iteración ${k}: capacidad_total = ${capacidad_total}`);
              } else if (k === 3) {
                var misma_semana_ultimo_año = fila_datos[0];
                var misma_semana_ultimo_año_por =
                  fila_datos.length > 1 ? fila_datos[1] : null;
                logger.info(
                  `Iteración ${k}: misma_semana_ultimo_año = ${misma_semana_ultimo_año}, misma_semana_ultimo_año_por = ${misma_semana_ultimo_año_por}`
                );
              } else if (k === 4) {
                var misma_semana_10años = fila_datos[0];
                var misma_semana_10años_por =
                  fila_datos.length > 1 ? fila_datos[1] : null;
                logger.info(
                  `Iteración ${k}: misma_semana_10años = ${misma_semana_10años}, misma_semana_10años_por = ${misma_semana_10años_por}`
                );
              }
            }
          }

          const sql = `
          INSERT INTO datos_embalses(
            fecha_modificacion,
            nombre_embalse,
            nombre_cuenca,
            agua_embalsada,
            agua_embalsadapor,
            variacion_ultima_semana,
            variacion_ultima_semanapor,
            capacidad_total,
            misma_semana_ultimo_año,
            misma_semana_ultimo_añopor,
            misma_semana_10años,
            misma_semana_10añospor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            fecha_modificacion = VALUES(fecha_modificacion),
            agua_embalsada = VALUES(agua_embalsada),
            agua_embalsadapor = VALUES(agua_embalsadapor),
            variacion_ultima_semana = VALUES(variacion_ultima_semana),
            variacion_ultima_semanapor = VALUES(variacion_ultima_semanapor),
            capacidad_total = VALUES(capacidad_total),
            misma_semana_ultimo_año = VALUES(misma_semana_ultimo_año),
            misma_semana_ultimo_añopor = VALUES(misma_semana_ultimo_añopor),
            misma_semana_10años = VALUES(misma_semana_10años),
            misma_semana_10añospor = VALUES(misma_semana_10añospor)
          `;

          await cursor.execute(sql, [
            fecha_modificacion,
            embalse,
            cuenca,
            agua_embalsada,
            agua_embalsada_por,
            variacion_ultima_semana,
            variacion_ultima_semana_por,
            capacidad_total,
            misma_semana_ultimo_año,
            misma_semana_ultimo_año_por,
            misma_semana_10años,
            misma_semana_10años_por,
          ]);

          await conn.commit();
        }
      }
    }
  }

  await conn.end(); // Cerrando la conexión con la base de datos al finalizar.
}

// Llamada a la función principal
main().catch(console.error);
