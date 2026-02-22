/**
 * Admin API - Gateway légère pour Docker et monitoring
 * Exécute des scripts sur l'hôte via conteneurs temporaires
 */

const express = require('express');
const Docker = require('dockerode');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;
const SCRIPTS_PATH = process.env.SCRIPTS_PATH || '/home/graphandco/monitoring';
const SCRIPT_TIMEOUT_MS = 60000; // 60s max par script

// Client Docker via socket monté
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Scripts autorisés (whitelist)
const ALLOWED_SCRIPTS = ['server-status.sh'];

// Middleware
app.use(express.json());

// Santé de l'API
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'admin-api' });
});

/**
 * Exécute un script sur l'hôte via un conteneur temporaire.
 * Le conteneur a accès à /, /proc, /sys du host (chroot).
 */
async function runHostScript(scriptName) {
  if (!ALLOWED_SCRIPTS.includes(scriptName)) {
    throw new Error(`Script non autorisé: ${scriptName}`);
  }
  const scriptPath = `${SCRIPTS_PATH}/${scriptName}`;
  // Utilise docker:cli pour les scripts qui pourraient appeler docker (ex: docker ps)
  const escapedPath = scriptPath.replace(/'/g, "'\\''");
  const cmd = `docker run --rm \
    -v /:/host:ro \
    -v /proc:/proc:ro \
    -v /sys:/sys:ro \
    -v /var/run/docker.sock:/var/run/docker.sock \
    docker:cli \
    sh -c "chroot /host '${escapedPath}'"`;
  const { stdout, stderr } = await execAsync(cmd, {
    timeout: SCRIPT_TIMEOUT_MS,
    env: { ...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock' },
  });
  return { stdout: stdout.trim(), stderr: stderr?.trim() || '' };
}

/**
 * GET /api/docker/ps
 * Liste les conteneurs (équivalent de docker ps -a)
 */
app.get('/api/docker/ps', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const formatted = containers.map(c => ({
      id: c.Id,
      shortId: c.Id.substring(0, 12),
      names: c.Names,
      image: c.Image,
      status: c.Status,
      state: c.State,
      created: c.Created,
      ports: c.Ports,
    }));
    res.json({ success: true, count: formatted.length, containers: formatted });
  } catch (err) {
    console.error('docker ps error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des conteneurs',
      message: err.message,
    });
  }
});

/**
 * GET /api/scripts/server-status
 * Exécute server-status.sh sur l'hôte et retourne la sortie
 */
app.get('/api/scripts/server-status', async (req, res) => {
  try {
    const { stdout, stderr } = await runHostScript('server-status.sh');
    res.json({
      success: true,
      script: 'server-status.sh',
      stdout,
      stderr: stderr || undefined,
    });
  } catch (err) {
    console.error('server-status error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'exécution du script',
      message: err.message,
      stdout: err.stdout,
      stderr: err.stderr,
    });
  }
});

// 404
app.use((_, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Démarrage
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Admin API listening on port ${PORT}`);
});
