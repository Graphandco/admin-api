/**
 * Routes CRUD pour les contrats (liés aux clients)
 */
const express = require('express');
const { getPool } = require('../lib/db');

const router = express.Router();

function rowToContract(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    filename: row.filename ?? '',
    created_at: row.created_at ? row.created_at.toISOString?.() ?? String(row.created_at) : null,
    client_company: row.client_company ?? '',
    client_name: row.client_name ?? '',
  };
}

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT ct.id, ct.client_id, ct.filename, ct.created_at,
              c.company AS client_company, c.name AS client_name
       FROM contracts ct
       LEFT JOIN clients c ON c.id = ct.client_id
       ORDER BY ct.created_at DESC`
    );
    res.json({ success: true, contracts: rows.map(rowToContract) });
  } catch (err) {
    console.error('contracts list error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Erreur lors de la récupération des contrats' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { client_id, filename } = body;
    if (!client_id || !filename) {
      return res.status(400).json({ success: false, error: 'client_id et filename requis' });
    }
    const pool = getPool();
    const [result] = await pool.query(
      'INSERT INTO contracts (client_id, filename) VALUES (?, ?)',
      [Number(client_id), String(filename).slice(0, 255)]
    );
    const [rows] = await pool.query(
      `SELECT ct.id, ct.client_id, ct.filename, ct.created_at,
              c.company AS client_company, c.name AS client_name
       FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ success: true, contract: rowToContract(rows[0]) });
  } catch (err) {
    console.error('contracts create error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Erreur lors de la création du contrat' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT id, filename FROM contracts WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Contrat introuvable' });
    }
    const filename = rows[0].filename;
    await pool.query('DELETE FROM contracts WHERE id = ?', [req.params.id]);
    res.json({ success: true, filename });
  } catch (err) {
    console.error('contracts delete error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Erreur lors de la suppression' });
  }
});

module.exports = router;
