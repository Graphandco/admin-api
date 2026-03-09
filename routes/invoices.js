/**
 * Routes CRUD pour les factures (liées aux clients)
 */
const express = require('express');
const { getPool } = require('../lib/db');

const router = express.Router();

function rowToInvoice(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    invoice_number: row.invoice_number ?? '',
    filename: row.filename ?? '',
    total_ttc: row.total_ttc != null ? Number(row.total_ttc) : null,
    created_at: row.created_at ? row.created_at.toISOString?.() ?? String(row.created_at) : null,
    client_company: row.client_company ?? '',
    client_name: row.client_name ?? '',
  };
}

/**
 * GET /invoices - Liste toutes les factures avec infos client
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT i.id, i.client_id, i.invoice_number, i.filename, i.total_ttc, i.created_at,
              c.company AS client_company, c.name AS client_name
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       ORDER BY i.created_at DESC`
    );
    res.json({
      success: true,
      invoices: rows.map(rowToInvoice),
    });
  } catch (err) {
    console.error('invoices list error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des factures',
    });
  }
});

/**
 * POST /invoices - Créer une facture
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { client_id, invoice_number, filename, total_ttc } = body;
    if (!client_id || !filename) {
      return res.status(400).json({
        success: false,
        error: 'client_id et filename requis',
      });
    }
    const totalTtcVal = total_ttc != null && total_ttc !== '' ? Number(total_ttc) : null;
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO invoices (client_id, invoice_number, filename, total_ttc)
       VALUES (?, ?, ?, ?)`,
      [Number(client_id), String(invoice_number || '').slice(0, 100), String(filename).slice(0, 255), totalTtcVal]
    );
    const [rows] = await pool.query(
      `SELECT i.id, i.client_id, i.invoice_number, i.filename, i.total_ttc, i.created_at,
              c.company AS client_company, c.name AS client_name
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = ?`,
      [result.insertId]
    );
    res.status(201).json({
      success: true,
      invoice: rowToInvoice(rows[0]),
    });
  } catch (err) {
    console.error('invoices create error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la création de la facture',
    });
  }
});

/**
 * DELETE /invoices/:id - Supprimer une facture (retourne filename pour suppression du fichier)
 */
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT id, filename FROM invoices WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Facture introuvable',
      });
    }
    const filename = rows[0].filename;
    await pool.query('DELETE FROM invoices WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      filename,
    });
  } catch (err) {
    console.error('invoices delete error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la suppression',
    });
  }
});

module.exports = router;
