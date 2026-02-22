/**
 * Routes Docker - liste des conteneurs, stats, logs
 */

const express = require('express');
const Docker = require('dockerode');
const { DOCKER_SOCKET_PATH } = require('../config');

const router = express.Router();
const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });

/**
 * GET /ps - Liste des conteneurs (équivalent de docker ps -a)
 */
router.get('/ps', async (req, res) => {
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
 * GET /stats - Stats des conteneurs (CPU, mémoire)
 */
router.get('/stats', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: false });
    const statsPromises = containers.map(async (c) => {
      try {
        const container = docker.getContainer(c.Id);
        const stats = await new Promise((resolve, reject) => {
          container.stats({ stream: false }, (err, data) => {
            if (err) return reject(err);
            resolve(data);
          });
        });
        const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
        return { id: c.Id, name, ...stats };
      } catch {
        return null;
      }
    });
    const statsList = (await Promise.all(statsPromises)).filter(Boolean);
    res.json({ success: true, stats: statsList });
  } catch (err) {
    console.error('docker stats error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des stats',
      message: err.message,
    });
  }
});

/**
 * GET /logs?container=xxx - Logs d'un conteneur
 */
router.get('/logs', async (req, res) => {
  try {
    const containerId = req.query.container;
    if (!containerId) {
      return res.status(400).json({ success: false, error: 'Paramètre container requis' });
    }
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const { stdout } = await execAsync(`docker logs --tail 200 ${containerId} 2>&1`, {
      timeout: 10000,
      maxBuffer: 512 * 1024,
    });
    res.json({ success: true, logs: stdout || '' });
  } catch (err) {
    console.error('docker logs error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des logs',
      message: err.message,
    });
  }
});

module.exports = router;
