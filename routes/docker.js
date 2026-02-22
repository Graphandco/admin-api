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

/*
 * GET /stats - Stats des conteneurs (CPU, mémoire) - DÉSACTIVÉ (non utilisé)
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
*/

/**
 * POST /container/:id/start - Démarrer un conteneur
 */
router.post('/container/:id/start', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.start();
    res.json({ success: true });
  } catch (err) {
    console.error('docker start error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur au démarrage du conteneur',
    });
  }
});

/**
 * POST /container/:id/stop - Arrêter un conteneur
 */
router.post('/container/:id/stop', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.stop();
    res.json({ success: true });
  } catch (err) {
    console.error('docker stop error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur à l\'arrêt du conteneur',
    });
  }
});

/**
 * POST /container/:id/remove - Supprimer un conteneur
 */
router.post('/container/:id/remove', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.remove({ force: true });
    res.json({ success: true });
  } catch (err) {
    console.error('docker remove error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur à la suppression du conteneur',
    });
  }
});

/**
 * POST /container/:id/compose - Démarrer via docker compose up
 */
router.post('/container/:id/compose', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const inspect = await container.inspect();
    const labels = inspect.Config?.Labels || {};
    const project = labels['com.docker.compose.project'];
    const service = labels['com.docker.compose.service'];
    const workingDir = labels['com.docker.compose.project.working_dir'];
    const projectsRoot = process.env.COMPOSE_PROJECTS_ROOT || '/var/www/docker-stack';
    const baseDir = workingDir || (project ? `${projectsRoot}/${project}` : null);
    if (!project || !service || !baseDir) {
      return res.status(400).json({
        success: false,
        error: 'Conteneur non géré par docker compose ou labels manquants',
      });
    }
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const cmd = `cd ${baseDir} && docker compose -p ${project} up -d ${service}`;
    await execAsync(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 });
    res.json({ success: true });
  } catch (err) {
    console.error('docker compose up error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors du démarrage compose',
    });
  }
});

/**
 * POST /container/:id/build - Build (via docker compose)
 */
router.post('/container/:id/build', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const inspect = await container.inspect();
    const labels = inspect.Config?.Labels || {};
    const project = labels['com.docker.compose.project'];
    const service = labels['com.docker.compose.service'];
    const workingDir = labels['com.docker.compose.project.working_dir'];
    const projectsRoot = process.env.COMPOSE_PROJECTS_ROOT || '/var/www/docker-stack';
    const baseDir = workingDir || (project ? `${projectsRoot}/${project}` : null);
    if (!project || !service || !baseDir) {
      return res.status(400).json({
        success: false,
        error: 'Conteneur non géré par docker compose ou labels manquants',
      });
    }
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const cmd = `cd ${baseDir} && docker compose -p ${project} build ${service}`;
    await execAsync(cmd, { timeout: 120000, maxBuffer: 1024 * 1024 });
    res.json({ success: true });
  } catch (err) {
    console.error('docker build error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors du build',
    });
  }
});

/*
 * GET /logs?container=xxx - Logs d'un conteneur - DÉSACTIVÉ (vulnérable à l'injection, non utilisé)
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
*/

module.exports = router;
