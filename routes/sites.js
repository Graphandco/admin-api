/**
 * Routes pour les sites (Agence)
 * Table websites: id, client_id, address, backoffice
 */
const express = require('express');
const { getPool } = require('../lib/db');

const router = express.Router();

function rowToSite(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    address: row.address ?? '',
    backoffice: row.backoffice ?? '',
    client_company: row.client_company ?? '',
    client_name: row.client_name ?? '',
  };
}

/**
 * GET /sites - Liste tous les sites avec nom client
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT w.id, w.client_id, w.address, w.backoffice,
              c.company AS client_company, c.name AS client_name
       FROM websites w
       LEFT JOIN clients c ON c.id = w.client_id
       ORDER BY w.address ASC`
    );
    res.json({ success: true, sites: rows.map(rowToSite) });
  } catch (err) {
    console.error('sites list error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des sites',
    });
  }
});

/**
 * PUT /sites/:id - Modifier un site
 */
router.put('/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const pool = getPool();
    const [result] = await pool.query(
      `UPDATE websites SET address = ?, backoffice = ? WHERE id = ?`,
      [
        String(body.address ?? '').trim().slice(0, 500),
        String(body.backoffice ?? '').trim().slice(0, 500),
        req.params.id,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Site introuvable' });
    }
    const [rows] = await pool.query(
      `SELECT w.id, w.client_id, w.address, w.backoffice,
              c.company AS client_company, c.name AS client_name
       FROM websites w
       LEFT JOIN clients c ON c.id = w.client_id
       WHERE w.id = ?`,
      [req.params.id]
    );
    res.json({ success: true, site: rowToSite(rows[0]) });
  } catch (err) {
    console.error('sites update error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la modification du site',
    });
  }
});

module.exports = router;
