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
 * GET /stats - Stats RAM de tous les conteneurs running (pour le graphique)
 */
router.get('/stats', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: false });
    const results = await Promise.all(
      containers.map(async (c) => {
        try {
          const container = docker.getContainer(c.Id);
          const stats = await new Promise((resolve, reject) => {
            container.stats({ stream: false }, (err, data) => {
              if (err) return reject(err);
              resolve(data);
            });
          });
          const memUsage = stats.memory_stats?.usage ?? 0;
          const memLimit = stats.memory_stats?.limit || stats.memory_stats?.max_usage || 1;
          const memPercent = memLimit > 0 ? Math.round((memUsage / memLimit) * 100) : 0;
          const name = c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
          return { id: c.Id, name, memory: { used: memUsage, total: memLimit, percent: memPercent } };
        } catch {
          return null;
        }
      })
    );
    const statsList = results.filter(Boolean);
    res.json({ success: true, stats: statsList });
  } catch (err) {
    console.error('docker stats all error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Erreur lors de la récupération des stats' });
  }
});

/**
 * GET /stats/:id - Stats d'un conteneur (CPU, RAM, uptime)
 */
router.get('/stats/:id', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const stats = await new Promise((resolve, reject) => {
      container.stats({ stream: false }, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
    const memUsage = stats.memory_stats?.usage ?? 0;
    const memLimit = stats.memory_stats?.limit || stats.memory_stats?.max_usage || 1;
    const memPercent = memLimit > 0 ? Math.round((memUsage / memLimit) * 100) : 0;

    const cpuStats = stats.cpu_stats || {};
    const precpuStats = stats.precpu_stats || {};
    const cpuUsage = cpuStats.cpu_usage?.total_usage ?? 0;
    const precpuUsage = precpuStats.cpu_usage?.total_usage ?? 0;
    const systemUsage = cpuStats.system_cpu_usage ?? 0;
    const presystemUsage = precpuStats.system_cpu_usage ?? 0;
    const cpuDelta = Math.max(0, cpuUsage - precpuUsage);
    const systemDelta = Math.max(1, systemUsage - presystemUsage);
    const numCpus = (cpuStats.online_cpus ?? (cpuStats.cpu_usage?.percpu_usage?.length || 1));
    const cpuPercent = Math.min(100, Math.round((cpuDelta / systemDelta) * 100 * numCpus));

    let uptime = null;
    try {
      const inspect = await container.inspect();
      const startedAt = inspect.State?.StartedAt;
      if (startedAt && inspect.State?.Running) {
        uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      }
    } catch {}

    res.json({
      success: true,
      stats: {
        memory: { used: memUsage, total: memLimit, percent: memPercent },
        cpu: { percent: cpuPercent },
        uptime,
      },
    });
  } catch (err) {
    console.error('docker container stats error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des stats',
    });
  }
});

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

/**
 * Démultiplexe le flux de logs Docker (format 8-byte header + payload)
 */
function demuxDockerLogs(buffer) {
  const result = [];
  let offset = 0;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  while (offset < buf.length) {
    if (offset + 8 > buf.length) break;
    const streamType = buf[offset];
    const length = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + length > buf.length) break;
    const chunk = buf.slice(offset, offset + length);
    offset += length;
    result.push(chunk.toString('utf8'));
  }
  return result.join('');
}

/**
 * GET /logs?container=xxx&tail=100 - Logs d'un conteneur (Dockerode)
 */
router.get('/logs', async (req, res) => {
  try {
    const containerId = (req.query.container || '').trim();
    const tail = Math.min(500, Math.max(1, parseInt(req.query.tail, 10) || 100));
    if (!containerId) {
      return res.status(400).json({ success: false, error: 'Paramètre container requis' });
    }
    const container = docker.getContainer(containerId);
    const rawLogs = await new Promise((resolve, reject) => {
      container.logs(
        { follow: false, tail, stdout: true, stderr: true },
        (err, data) => {
          if (err) return reject(err);
          if (Buffer.isBuffer(data)) {
            return resolve(data);
          }
          const chunks = [];
          data.on('data', (chunk) => chunks.push(chunk));
          data.on('end', () => resolve(Buffer.concat(chunks)));
          data.on('error', reject);
        }
      );
    });
    const logs = demuxDockerLogs(rawLogs);
    res.json({ success: true, logs: logs || '' });
  } catch (err) {
    console.error('docker logs error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des logs',
    });
  }
});

module.exports = router;
