// Importamos las librerías necesarias
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const ProgressBar = require('progress');

// Establecemos la fecha de modificación
const fecha_modificacion = new Date().toISOString().slice(0, 19).replace('T', ' ');

// URL de la página web a raspar
const url = "https://www.embalses.net/cuencas.php";

// Objeto para almacenar los datos
const embalsesData = {};

// Array para almacenar los mensajes
const messages = [];

// Función para raspar los datos
const scrapeData = async () => {
  try {
    // Hacemos una petición HTTP a la URL
    const response = await axios.get(url);
    // Cargamos el HTML de la respuesta en Cheerio
    const $ = cheerio.load(response.data);
    
    // Obtenemos la tabla con los datos
    const table = $('table.Tabla');

    // Obtenemos todas las filas con los datos
    const rows = table.find('tr.ResultadoCampo');

    // Creamos una nueva instancia de la barra de progreso
    const bar = new ProgressBar(':bar :percent :etas', { total: rows.length });

    // Iteramos sobre cada fila
    for (let row of rows) {
      // Obtenemos las columnas de la fila
      const columns = $(row).find('td');
      // Obtenemos el nombre de la cuenca y el enlace a su página
      const cuenca = $(columns[0]).text().trim();
      const cuencaLink = $(columns[0]).find('a').attr('href');

      // Hacemos una nueva petición HTTP a la URL de la cuenca
      const cuencaResponse = await axios.get(`https://www.embalses.net/${cuencaLink}`);
      // Cargamos el HTML de la respuesta en Cheerio
      const cuenca$ = cheerio.load(cuencaResponse.data);
      // Obtenemos la tabla con los datos de la cuenca
      const cuencaTable = cuenca$('table.Tabla');
      // Obtenemos todas las filas con los datos de la cuenca
      const cuencaRows = cuencaTable.find('tr.ResultadoCampo');

      // Iteramos sobre cada fila de la cuenca
      for (let cuencaRow of cuencaRows) {
        // Obtenemos las columnas de la fila
        const cuencaColumns = cuenca$(cuencaRow).find('td');
        // Si la fila tiene al menos 3 columnas
        if (cuencaColumns.length >= 3) {
          // Obtenemos el nombre del embalse y el enlace a su página
          let embalse = cuenca$(cuencaColumns[0]).text().trim().replace('Ã±', 'ñ').replace('[+]', '');
          const embalseLink = cuenca$(cuencaColumns[0]).find('a').attr('href');

          // Almacenamos el mensaje en el array en lugar de imprimirlo
          messages.push(`Embalse: ${embalse} | Cuenca: ${cuenca}`);

          // Hacemos una nueva petición HTTP a la URL del embalse
          const embalseResponse = await axios.get(`https://www.embalses.net/${embalseLink}`);
          // Cargamos el HTML de la respuesta en Cheerio
          const embalse$ = cheerio.load(embalseResponse.data);
          // Obtenemos los divs con los datos del embalse
          const divs = embalse$('div.SeccionCentral_Caja');

          // Si hay al menos dos divs
          if (divs.length < 2) {
            console.log(`No se encontraron al menos dos divs con la clase 'SeccionCentral_Caja' en el embalse ${embalse}`);
          } else {
            // Obtenemos el segundo div
            const secondDiv = divs.eq(1);
            // Obtenemos los divs con los datos
            const filaSeccionDivs = secondDiv.find('div.FilaSeccion');
            // Creamos un objeto para almacenar los datos
            const datos = {};

            // Iteramos sobre cada div con los datos
            filaSeccionDivs.each((i, filaSeccionDiv) => {
              // Obtenemos los divs con el campo, el resultado y la unidad
              const campoDiv = embalse$(filaSeccionDiv).find('div.Campo');
              const resultadoDivs = embalse$(filaSeccionDiv).find('div.Resultado');
              const unidadDivs = embalse$(filaSeccionDiv).find('div.Unidad, div.Unidad2');

              // Si los divs existen
              if (campoDiv && resultadoDivs.length && unidadDivs.length) {
                // Creamos un array para almacenar los datos de la fila
                const filaDatos = [];
                // Iteramos sobre cada div con el resultado
                resultadoDivs.each((idx, resultadoDiv) => {
                  // Obtenemos el resultado y lo añadimos al array
                  const resultado = embalse$(resultadoDiv).text().trim();
                  filaDatos.push(resultado);
                });

                // Dependiendo del índice del div, almacenamos los datos en el objeto
                if (i === 0) {
                  datos.agua_embalsada = filaDatos[0].replace('.', '');
                  datos.agua_embalsada_por = filaDatos.length > 1 ? filaDatos[1] : null;
                } else if (i === 1) {
                  datos.variacion_ultima_semana = filaDatos[0];
                  datos.variacion_ultima_semana_por = filaDatos.length > 1 ? filaDatos[1] : null;
                } else if (i === 2) {
                  datos.capacidad_total = filaDatos[0].replace('.', '');
                } else if (i === 3) {
                  datos.misma_semana_ultimo_year = filaDatos[0];
                  datos.misma_semana_ultimo_year_por = filaDatos.length > 1 ? filaDatos[1] : null;
                } else if (i === 4) {
                  datos.misma_semana_10years = filaDatos[0];
                  datos.misma_semana_10years_por = filaDatos.length > 1 ? filaDatos[1] : null;
                }
              }
            });

            // Almacenamos los datos en el objeto
            embalsesData[embalse] = {
              fecha_modificacion,
              cuenca,
              ...datos
            };
          }
        }
      }

      // Actualizamos la barra de progreso
      bar.tick();

      // Si la barra de progreso está completa
      if (bar.complete) {
        console.log('\nScraping complete!\n');

        // Imprimimos todos los mensajes
        for (let message of messages) {
          console.log(message);
        }
      }
    }

    // Escribimos los datos en un archivo JSON
    fs.writeFileSync('embalsesData.json', JSON.stringify(embalsesData, null, 2));

    console.log('Data saved to embalsesData.json');
  } catch (error) {
    console.error(error);
  }
};

// Llamamos a la función para raspar los datos
scrapeData();