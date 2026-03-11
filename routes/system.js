/**
 * Routes pour les stats système du VPS (RAM, CPU, disque)
 * Lit les métriques du HÔTE via /hostproc et /hostfs montés dans le conteneur.
 */
const express = require('express');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { getPool } = require('../lib/db');

const router = express.Router();

const HOST_PROC = '/hostproc';
const HOST_FS = '/hostfs';

function canReadHost() {
  try {
    fs.accessSync(path.join(HOST_PROC, 'meminfo'), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseMeminfo() {
  const meminfoPath = path.join(HOST_PROC, 'meminfo');
  const content = fs.readFileSync(meminfoPath, 'utf8');
  const lines = content.split('\n');
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(key));
    if (!line) return 0;
    const match = line.match(/\d+/);
    return match ? parseInt(match[0], 10) * 1024 : 0; // kB -> bytes
  };
  const memTotal = get('MemTotal:');
  const memAvailable = get('MemAvailable:');
  const memUsed = memTotal - memAvailable;
  return { total: memTotal, used: memUsed };
}

async function parseCpuStat() {
  const statPath = path.join(HOST_PROC, 'stat');
  let prevTotal, prevIdle;
  try {
    const prev = fs.readFileSync(statPath, 'utf8');
    const prevFields = prev.split('\n')[0].split(/\s+/).slice(1).map(Number);
    prevTotal = prevFields.reduce((a, b) => a + b, 0);
    prevIdle = prevFields[3];
  } catch {
    return 0;
  }

  await new Promise((r) => setTimeout(r, 500));

  try {
    const curr = fs.readFileSync(statPath, 'utf8');
    const currFields = curr.split('\n')[0].split(/\s+/).slice(1).map(Number);
    const currTotal = currFields.reduce((a, b) => a + b, 0);
    const currIdle = currFields[3];
    const totalDelta = currTotal - prevTotal;
    const idleDelta = currIdle - prevIdle;
    const percent = totalDelta > 0 ? Math.round(100 * (1 - idleDelta / totalDelta)) : 0;
    return Math.min(100, Math.max(0, percent));
  } catch {
    return 0;
  }
}

function parseUptime() {
  try {
    const content = fs.readFileSync(path.join(HOST_PROC, 'uptime'), 'utf8');
    const match = content.match(/^(\d+(?:\.\d+)?)/);
    const seconds = match ? parseFloat(match[1]) : 0;
    return Math.floor(seconds);
  } catch {
    return 0;
  }
}

function parseDf() {
  try {
    const out = execSync(`df -k ${HOST_FS} 2>/dev/null | tail -1`, { encoding: 'utf8' });
    const parts = out.trim().split(/\s+/);
    // df -k : Filesystem 1K-blocks Used Available Use% Mounted
    const totalK = parseInt(parts[1], 10) || 0;
    const usedK = parseInt(parts[2], 10) || 0;
    const total = totalK * 1024;
    const used = usedK * 1024;
    return { total, used };
  } catch {
    return { total: 0, used: 0 };
  }
}

const VPS_METRICS_TABLE = 'vps_metrics';

async function ensureMetricsTable(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${VPS_METRICS_TABLE} (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cpu_percent TINYINT UNSIGNED,
      mem_used BIGINT UNSIGNED,
      mem_total BIGINT UNSIGNED,
      disk_used BIGINT UNSIGNED,
      disk_total BIGINT UNSIGNED
    )
  `);
  try {
    await pool.execute(`CREATE INDEX idx_vps_metrics_ts ON ${VPS_METRICS_TABLE}(ts)`);
  } catch (e) {
    if (!e.message?.includes('Duplicate key name')) throw e;
  }
}

/**
 * GET /system/collect-metrics - Collecte et stocke les métriques (appelé par cron toutes les 15 min)
 * Supprime les données > 7 jours avant insertion.
 */
router.get('/collect-metrics', async (req, res) => {
  try {
    if (!canReadHost()) {
      return res.status(503).json({
        success: false,
        error: 'Stats VPS indisponibles: montage /hostproc manquant.',
      });
    }

    const pool = getPool();
    await ensureMetricsTable(pool);

    await pool.execute(`DELETE FROM ${VPS_METRICS_TABLE} WHERE ts < NOW() - INTERVAL 7 DAY`);

    const [mem, cpuPercent, disk] = await Promise.all([
      Promise.resolve(parseMeminfo()),
      parseCpuStat(),
      Promise.resolve(parseDf()),
    ]);

    await pool.execute(
      `INSERT INTO ${VPS_METRICS_TABLE} (ts, cpu_percent, mem_used, mem_total, disk_used, disk_total)
       VALUES (NOW(), ?, ?, ?, ?, ?)`,
      [cpuPercent, mem.used, mem.total, disk.used, disk.total]
    );

    res.json({ success: true, message: 'Métriques enregistrées' });
  } catch (err) {
    console.error('collect-metrics error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la collecte',
    });
  }
});

/**
 * GET /system/stats/history?date=YYYY-MM-DD - Historique des métriques sur 24h
 * date: optionnel, défaut = aujourd'hui. Doit être dans les 7 derniers jours.
 */
router.get('/stats/history', async (req, res) => {
  try {
    const pool = getPool();
    let dateStr = req.query.date;
    if (!dateStr) {
      const now = new Date();
      dateStr = now.toISOString().slice(0, 10);
    }
    const match = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Format date invalide (YYYY-MM-DD)' });
    }
    const date = new Date(dateStr + 'T12:00:00Z');
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    if (date < sevenDaysAgo || date > now) {
      return res.status(400).json({ success: false, error: 'Date hors de la plage (7 derniers jours)' });
    }

    const [rows] = await pool.execute(
      `SELECT ts, cpu_percent, mem_used, mem_total, disk_used, disk_total
       FROM ${VPS_METRICS_TABLE}
       WHERE ts >= ? AND ts < DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY ts ASC`,
      [dateStr, dateStr]
    );

    const data = rows.map((r) => ({
      ts: r.ts,
      cpu_percent: r.cpu_percent ?? 0,
      mem_percent: r.mem_total > 0 ? Math.round((r.mem_used / r.mem_total) * 100) : 0,
      disk_percent: r.disk_total > 0 ? Math.round((r.disk_used / r.disk_total) * 100) : 0,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('stats/history error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération',
    });
  }
});

/**
 * GET /system/stats - RAM, CPU, disque (métriques du VPS hôte)
 */
router.get('/stats', async (req, res) => {
  try {
    if (!canReadHost()) {
      return res.status(503).json({
        success: false,
        error: 'Stats VPS indisponibles: montage /hostproc manquant. Vérifiez les volumes du conteneur admin-api (docker-compose).',
      });
    }

    const [mem, cpuPercent, disk, uptimeSeconds] = await Promise.all([
      Promise.resolve(parseMeminfo()),
      parseCpuStat(),
      Promise.resolve(parseDf()),
      Promise.resolve(parseUptime()),
    ]);

    const totalMem = mem.total;
    const usedMem = mem.used;
    const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

    const diskUsed = disk.used;
    const diskTotal = disk.total;
    const diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

    res.json({
      success: true,
      stats: {
        uptime: uptimeSeconds,
        memory: {
          used: usedMem,
          total: totalMem,
          percent: memPercent,
          usedFormatted: formatBytes(usedMem),
          totalFormatted: formatBytes(totalMem),
        },
        cpu: {
          percent: cpuPercent,
        },
        disk: {
          used: diskUsed,
          total: diskTotal,
          percent: diskPercent,
          usedFormatted: formatBytes(diskUsed),
          totalFormatted: formatBytes(diskTotal),
        },
      },
    });
  } catch (err) {
    console.error('system stats error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des stats',
    });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

module.exports = router;
