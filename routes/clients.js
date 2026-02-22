/**
 * Routes CRUD pour les clients
 */
const express = require('express');
const { getPool } = require('../lib/db');

const router = express.Router();

const FIELDS = [
  'name', 'company', 'email', 'website', 'phone', 'adresse',
  'payment_date', 'annual_cost', 'creation_cost', 'invoice',
];

function rowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name ?? '',
    company: row.company ?? '',
    email: row.email ?? '',
    website: row.website ?? '',
    phone: row.phone ?? '',
    adresse: row.adresse ?? '',
    payment_date: row.payment_date ? String(row.payment_date).slice(0, 10) : null,
    annual_cost: row.annual_cost != null ? Number(row.annual_cost) : null,
    creation_cost: row.creation_cost != null ? Number(row.creation_cost) : null,
    invoice: Boolean(row.invoice),
  };
}

/**
 * GET /clients - Liste tous les clients
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT id, name, company, email, website, phone, adresse, payment_date, annual_cost, creation_cost, invoice FROM clients ORDER BY name ASC'
    );
    res.json({ success: true, clients: rows.map(rowToClient) });
  } catch (err) {
    console.error('clients list error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des clients',
    });
  }
});

/**
 * GET /clients/:id - Détail d'un client
 */
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT id, name, company, email, website, phone, adresse, payment_date, annual_cost, creation_cost, invoice FROM clients WHERE id = ?',
      [req.params.id]
    );
    const client = rows[0] ? rowToClient(rows[0]) : null;
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client introuvable' });
    }
    res.json({ success: true, client });
  } catch (err) {
    console.error('clients get error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération du client',
    });
  }
});

/**
 * POST /clients - Créer un client
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO clients (name, company, email, website, phone, adresse, payment_date, annual_cost, creation_cost, invoice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name ?? '',
        body.company ?? '',
        body.email ?? '',
        body.website ?? '',
        body.phone ?? '',
        body.adresse ?? '',
        body.payment_date || null,
        body.annual_cost != null ? Number(body.annual_cost) : null,
        body.creation_cost != null ? Number(body.creation_cost) : null,
        Boolean(body.invoice),
      ]
    );
    const [rows] = await pool.query(
      'SELECT id, name, company, email, website, phone, adresse, payment_date, annual_cost, creation_cost, invoice FROM clients WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ success: true, client: rowToClient(rows[0]) });
  } catch (err) {
    console.error('clients create error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la création du client',
    });
  }
});

/**
 * PUT /clients/:id - Modifier un client
 */
router.put('/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const pool = getPool();
    const [result] = await pool.query(
      `UPDATE clients SET
        name = ?, company = ?, email = ?, website = ?, phone = ?, adresse = ?,
        payment_date = ?, annual_cost = ?, creation_cost = ?, invoice = ?
       WHERE id = ?`,
      [
        body.name ?? '',
        body.company ?? '',
        body.email ?? '',
        body.website ?? '',
        body.phone ?? '',
        body.adresse ?? '',
        body.payment_date || null,
        body.annual_cost != null ? Number(body.annual_cost) : null,
        body.creation_cost != null ? Number(body.creation_cost) : null,
        Boolean(body.invoice),
        req.params.id,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Client introuvable' });
    }
    const [rows] = await pool.query(
      'SELECT id, name, company, email, website, phone, adresse, payment_date, annual_cost, creation_cost, invoice FROM clients WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, client: rowToClient(rows[0]) });
  } catch (err) {
    console.error('clients update error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la modification du client',
    });
  }
});

/**
 * DELETE /clients/:id - Supprimer un client
 */
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [result] = await pool.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Client introuvable' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('clients delete error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la suppression du client',
    });
  }
});

module.exports = router;
