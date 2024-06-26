import mysql from 'mysql2';
import axios from 'axios';
import cheerio from 'cheerio';
import { format } from 'date-fns';
import unidecode from 'unidecode';
// Conexión a la base de datos
const connection = mysql.createConnection({
  host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: 'DfWYA9vQa8C3KYP.root',
  password: 'bITJL8OzxMkIstMi',
  database: 'CuencasHidrograficas',
  ssl: {
    rejectUnauthorized: process.env.ssl_rejectUnauthorized,
  }
});

// URL de la página web que queremos scrappear
const url = 'https://www.embalses.net/cuencas.php';

// Realizamos la petición a la web
axios.get(url)
  .then(response => {
    // Pasamos el contenido HTML de la web a un objeto Cheerio
    const $ = cheerio.load(response.data);

    // Obtenemos la tabla donde están los datos
    const table = $('table.Tabla');

    // Recorremos todas las filas de la tabla para extraer los datos
    $('tr.ResultadoCampo', table).each((_, row) => {
      const columns = $('td', row);
      const cuenca = unidecode($(columns[0]).text().trim().replace(' ', '_'));
      const capacidad = $(columns[1]).text().trim();
      const embalsada = $(columns[2]).text().trim();
      const porcentaje_embalsada = parseFloat($(columns[3]).text().trim().replace('(', '').replace(')', '').replace('%', ''));
      const variacion = $(columns[4]).text().trim();
      const porcentaje_variacion = parseFloat($(columns[5]).text().trim().replace('(', '').replace(')', '').replace('%', ''));
      const fecha_modificacion = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

      // Verifica si la fila existe
      connection.query(
        `
        INSERT INTO CUENCA (fecha_modificacion, cuenca, capacidad, embalsada, porcentaje_embalsada, variacion, porcentaje_variacion)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        fecha_modificacion = VALUES(fecha_modificacion),
        capacidad = VALUES(capacidad),
        embalsada = VALUES(embalsada),
        porcentaje_embalsada = VALUES(porcentaje_embalsada),
        variacion = VALUES(variacion),
        porcentaje_variacion = VALUES(porcentaje_variacion)
        `,
        [fecha_modificacion, cuenca, capacidad, embalsada, porcentaje_embalsada, variacion, porcentaje_variacion],
        (error, results) => {
          if (error) {
            console.error(`Error executing SQL query: ${error}`);
          } else {
            console.log(`Datos insertados o actualizados para la cuenca ${cuenca}`);
          }
        }
      );
    });

    // Hacemos commit de la transacción
    connection.commit((error) => {
      if (error) {
        console.error(`Error committing transaction: ${error}`);
      } else {
        console.log('Transacción completada exitosamente');
      }
      connection.end();
    });
  })
  .catch(error => {
    console.error(`Error fetching data from website: ${error}`);
  });

