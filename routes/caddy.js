/**
 * Caddy - statut, config admin API (JSON), mapping, redirections, logs fichiers
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const express = require('express');
const Docker = require('dockerode');
const { DOCKER_SOCKET_PATH, CADDY_ADMIN_URL, CADDY_CONTAINER_NAME, CADDY_LOG_DIR } = require('../config');
const { parseCaddyConfig, postProcess } = require('../lib/caddy-config-parse');

const execFileAsync = promisify(execFile);
const router = express.Router();
const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });

const CADDY_LOG_WHITELIST = new Set(['access.log', 'caddy.log']);
const FETCH_TIMEOUT_MS = 15000;

function fetchCaddyConfigJson() {
  const url = `${CADDY_ADMIN_URL}/config/`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } })
    .finally(() => clearTimeout(t))
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Caddy admin HTTP ${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      return r.json();
    });
}

async function findCaddyContainer() {
  const want = (CADDY_CONTAINER_NAME || 'caddy').replace(/^\//, '');
  const list = await docker.listContainers({ all: true });
  const found = list.find((c) =>
    c.Names?.some((n) => n.replace(/^\//, '') === want),
  );
  if (!found) return null;
  return {
    id: found.Id,
    shortId: found.Id.substring(0, 12),
    names: found.Names,
    image: found.Image,
    status: found.Status,
    state: found.State,
    ports: found.Ports,
  };
}

/**
 * GET /status - Conteneur caddy + joignable admin API
 */
router.get('/status', async (req, res) => {
  try {
    const container = await findCaddyContainer();
    let adminOk = false;
    let adminError = null;
    try {
      await fetchCaddyConfigJson();
      adminOk = true;
    } catch (e) {
      adminError = e.message;
    }
    res.json({
      success: true,
      caddyAdminUrl: CADDY_ADMIN_URL,
      admin: { ok: adminOk, error: adminError },
      container,
    });
  } catch (err) {
    console.error('caddy status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /mapping
 */
router.get('/mapping', async (req, res) => {
  try {
    const raw = await fetchCaddyConfigJson();
    const parsed = postProcess(parseCaddyConfig(raw));
    res.json({ success: true, ...parsed });
  } catch (err) {
    console.error('caddy mapping error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /redirects
 */
router.get('/redirects', async (req, res) => {
  try {
    const raw = await fetchCaddyConfigJson();
    const parsed = postProcess(parseCaddyConfig(raw));
    res.json({ success: true, redirects: parsed.redirects });
  } catch (err) {
    console.error('caddy redirects error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * POST /validate — caddy validate dans le conteneur (même Caddyfile que le service)
 */
router.post('/validate', (req, res) => {
  const name = (CADDY_CONTAINER_NAME || 'caddy').replace(/^\//, '');
  const args = [
    'exec', name, 'caddy', 'validate',
    '--config', '/etc/caddy/Caddyfile',
    '--adapter', 'caddyfile',
  ];
  execFile('docker', args, { maxBuffer: 2 * 1024 * 1024, timeout: 90_000 }, (err, stdout, stderr) => {
    const out = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (err) {
      return res.json({
        success: true,
        valid: false,
        output: out || err.message,
      });
    }
    res.json({
      success: true,
      valid: true,
      output: out || 'Configuration valide.',
    });
  });
});

/**
 * GET /file-log?file=access.log&tail=200 — tail des journaux caddy (liste blanche)
 */
router.get('/file-log', async (req, res) => {
  const file = String(req.query.file || '').trim();
  const base = path.basename(file);
  const tail = Math.min(2000, Math.max(1, parseInt(req.query.tail, 10) || 200));
  if (!CADDY_LOG_WHITELIST.has(base)) {
    return res.status(400).json({
      success: false,
      error: 'Fichier non autorisé (access.log, caddy.log)',
    });
  }
  const full = path.join(CADDY_LOG_DIR, base);
  const safeDir = path.resolve(CADDY_LOG_DIR);
  if (!full.startsWith(safeDir + path.sep) && full !== safeDir) {
    return res.status(400).json({ success: false, error: 'Chemin refusé' });
  }
  try {
    await fs.promises.access(full, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ success: false, error: 'Fichier introuvable ou non monté sur admin-api' });
  }
  try {
    const { stdout, stderr } = await execFileAsync('tail', ['-n', String(tail), full], {
      maxBuffer: 4 * 1024 * 1024,
    });
    if (stderr) {
      return res.status(500).json({ success: false, error: stderr });
    }
    res.json({ success: true, file, log: stdout || '' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
