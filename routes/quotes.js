/**
 * Routes CRUD pour les devis (liés aux clients)
 */
const express = require('express');
const { getPool } = require('../lib/db');

const router = express.Router();

function rowToQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    quote_number: row.quote_number ?? '',
    filename: row.filename ?? '',
    total_ttc: row.total_ttc != null ? Number(row.total_ttc) : null,
    created_at: row.created_at ? row.created_at.toISOString?.() ?? String(row.created_at) : null,
    client_company: row.client_company ?? '',
    client_name: row.client_name ?? '',
  };
}

/**
 * GET /quotes - Liste tous les devis avec infos client
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT q.id, q.client_id, q.quote_number, q.filename, q.total_ttc, q.created_at,
              c.company AS client_company, c.name AS client_name
       FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
       ORDER BY q.created_at DESC`
    );
    res.json({
      success: true,
      quotes: rows.map(rowToQuote),
    });
  } catch (err) {
    console.error('quotes list error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des devis',
    });
  }
});

/**
 * POST /quotes - Créer un devis
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { client_id, quote_number, filename, total_ttc } = body;
    if (!client_id || !filename) {
      return res.status(400).json({
        success: false,
        error: 'client_id et filename requis',
      });
    }
    const totalTtcVal = total_ttc != null && total_ttc !== '' ? Number(total_ttc) : null;
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO quotes (client_id, quote_number, filename, total_ttc)
       VALUES (?, ?, ?, ?)`,
      [Number(client_id), String(quote_number || '').slice(0, 100), String(filename).slice(0, 255), totalTtcVal]
    );
    const [rows] = await pool.query(
      `SELECT q.id, q.client_id, q.quote_number, q.filename, q.total_ttc, q.created_at,
              c.company AS client_company, c.name AS client_name
       FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
       WHERE q.id = ?`,
      [result.insertId]
    );
    res.status(201).json({
      success: true,
      quote: rowToQuote(rows[0]),
    });
  } catch (err) {
    console.error('quotes create error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la création du devis',
    });
  }
});

/**
 * DELETE /quotes/:id - Supprimer un devis (retourne filename pour suppression du fichier)
 */
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT id, filename FROM quotes WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Devis introuvable',
      });
    }
    const filename = rows[0].filename;
    await pool.query('DELETE FROM quotes WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      filename,
    });
  } catch (err) {
    console.error('quotes delete error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la suppression',
    });
  }
});

module.exports = router;
