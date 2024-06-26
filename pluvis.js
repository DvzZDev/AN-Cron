import axios from "axios";
import cheerio from "cheerio";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection({
    host: "gateway01.eu-central-1.prod.aws.tidbcloud.com",
    port: 4000,
    user: "DfWYA9vQa8C3KYP.root",
    password: "bITJL8OzxMkIstMi",
    database: "CuencasHidrograficas",
    ssl: {
      rejectUnauthorized: "true",
    },
  });

  const url = "https://www.embalses.net/pluviometros-5.html";
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  let dataRows = [];
  const tableRows = $("table.Tabla tr");
  tableRows.each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length > 0) {
      const rowData = [];
      cells.each((j, cell) => {
        const cellText = $(cell).text().trim();
        rowData.push(cellText);
      });
      dataRows.push(rowData);
    }
  });

  // Elimina el primer elemento del array (el encabezado)
  dataRows.shift();

  console.log(`Se han recopilado ${dataRows.length} datos.`);

  for (const row of dataRows) {
    let nombre = row[0] === "?" ? null : row[0].replace(/\s*\[\+\]\s*$/, "");
    let provincia = row[1] === "?" ? null : row[1];
    let h1 = row[2] === "?" ? null : parseFloat(row[2]) || null;
    let h6 = row[3] === "?" ? null : parseFloat(row[3]) || null;
    let h12 = row[4] === "?" ? null : parseFloat(row[4]) || null;
    let h24 = row[5] === "?" ? null : parseFloat(row[5]) || null;

    console.log({
      nombre,
      provincia,
      h1,
      h6,
      h12,
      h24,
    });

    const sql = `
      INSERT INTO pluviometros(
        nombre,
        provincia,
        h1,
        h6,
        h12,
        h24
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        provincia = VALUES(provincia),
        h1 = VALUES(h1),
        h6 = VALUES(h6),
        h12 = VALUES(h12),
        h24 = VALUES(h24)
    `;
    await conn.execute(sql, [nombre, provincia, h1, h6, h12, h24]);
  }

  await conn.end();
}

main();
