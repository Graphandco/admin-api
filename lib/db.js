/**
 * Connexion MySQL pour l'API clients
 */
const mysql = require('mysql2/promise');
const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = require('../config');

let pool = null;

function getPool() {
  const missing = [];
  if (!MYSQL_HOST) missing.push('MYSQL_HOST');
  if (!MYSQL_DATABASE) missing.push('MYSQL_DATABASE');
  if (missing.length) {
    throw new Error(`Configuration MySQL incomplète : ${missing.join(', ')}. Vérifiez le fichier .env et les variables d'environnement.`);
  }
  if (!pool) {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD || undefined,
      database: MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

module.exports = { getPool };
