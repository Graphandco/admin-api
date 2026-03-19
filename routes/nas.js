/**
 * Routes monitoring NAS Unraid & Synology (RAM, CPU, uptime via SSH)
 * Utilise RESTIC_SSH_DIR pour les clés SSH.
 * NAS_UNRAID_IP / NAS_SYNOLOGY_IP et NAS_UNRAID_SSH_USER / NAS_SYNOLOGY_SSH_USER dans .env.
 * Exécute SSH dans un conteneur Alpine avec --network host (Tailscale).
 */
const express = require('express');
const { spawn } = require('child_process');
const {
  NAS_UNRAID_IP,
  NAS_UNRAID_SSH_USER,
  NAS_SYNOLOGY_IP,
  NAS_SYNOLOGY_SSH_USER,
  RESTIC_SSH_DIR,
} = require('../config');

const router = express.Router();

function runSshCmd(sshDir, user, host, cmd) {
  return new Promise((resolve, reject) => {
    const fullCmd = `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes ${user}@${host} "${cmd}"`;
    const args = [
      'run', '--rm', '--network', 'host',
      '-v', `${sshDir}:/root/.ssh:ro`,
      'alpine:latest',
      'sh', '-c',
      `apk add openssh-client -q && ${fullCmd}`,
    ];

    const proc = spawn('docker', args, { env: process.env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`SSH failed: ${cmd}`), { code, stderr }));
    });
  });
}

function parseFree(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('Mem:'));
  if (!line) return { total: 0, used: 0, available: 0, percent: 0 };
  const parts = line.split(/\s+/).filter(Boolean);
  const total = parseInt(parts[1], 10) * 1024 * 1024;
  const used = parseInt(parts[2], 10) * 1024 * 1024;
  const available = parseInt(parts[6], 10) * 1024 * 1024;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { total, used, available, percent };
}

/** Partitions principales à prioriser : Unraid /mnt/user, Synology /volume1, etc. */
const PREFERRED_MOUNTS = ['/mnt/user', '/volume1', '/mnt/cache', '/volume2', '/'];

function parseDf(stdout) {
  const lines = stdout.trim().split('\n').slice(1); // skip header
  const entries = [];

  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 6) continue;
    const mounted = parts[parts.length - 1];
    const usePct = parts[parts.length - 2];
    const available = parseInt(parts[parts.length - 3], 10);
    const used = parseInt(parts[parts.length - 4], 10);
    const total = parseInt(parts[parts.length - 5], 10);

    if (isNaN(total) || isNaN(used) || usePct === '-') continue;

    const totalBytes = total * 1024 * 1024;
    const usedBytes = used * 1024 * 1024;
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;

    entries.push({
      mount: mounted,
      total: totalBytes,
      used: usedBytes,
      available: available * 1024 * 1024,
      percent,
    });
  }

  for (const m of PREFERRED_MOUNTS) {
    const found = entries.find((e) => e.mount === m);
    if (found) return found;
  }
  return entries[0] || { total: 0, used: 0, available: 0, percent: 0, mount: '' };
}

function parseUptime(stdout) {
  const match = stdout.trim().match(/^(\d+(?:\.\d+)?)/);
  return match ? Math.floor(parseFloat(match[1])) : 0;
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

async function fetchNasStats(ip, user, sshDir, name) {
  if (!ip) {
    return {
      configured: false,
      message: `${name}: NAS_${name.toUpperCase().replace(/-/g, '_')}_IP non configuré dans .env`,
    };
  }

  const sshUser = user || 'root';

  try {
    const cmd = "free -m | head -2; echo '---DF---'; df -m; echo '---UPTIME---'; cat /proc/uptime";
    const { stdout } = await runSshCmd(sshDir, sshUser, ip, cmd);

    const [memBlock, rest1] = stdout.split('---DF---').map((s) => s.trim());
    const [dfBlock, uptimePart] = (rest1 || '').split('---UPTIME---').map((s) => s.trim());

    const mem = parseFree(memBlock || '');
    const disk = parseDf(dfBlock || '');
    const uptimeSeconds = parseUptime(uptimePart || '0');

    return {
      configured: true,
      host: ip,
      stats: {
        uptime: uptimeSeconds,
        memory: {
          used: mem.used,
          total: mem.total,
          available: mem.available,
          percent: mem.percent,
          usedFormatted: formatBytes(mem.used),
          totalFormatted: formatBytes(mem.total),
        },
        disk: {
          used: disk.used,
          total: disk.total,
          available: disk.available,
          percent: disk.percent,
          usedFormatted: formatBytes(disk.used),
          totalFormatted: formatBytes(disk.total),
          mount: disk.mount || '',
        },
      },
    };
  } catch (err) {
    const stderr = err.stderr || err.message || '';
    const combined = [err.message, stderr].filter(Boolean).join('\n');

    const isAuth = /permission denied|publickey|authentication failed/i.test(combined);
    const isNetwork = /connection refused|no route|timeout|network|unreachable|econnrefused/i.test(combined);

    let errorMessage = 'Erreur lors de la récupération des stats';
    if (isAuth) errorMessage = 'SSH : clé refusée (vérifiez authorized_keys sur le NAS)';
    else if (isNetwork) errorMessage = 'Impossible de joindre le NAS (Tailscale ? IP ?)';

    console.error(`nas stats ${name} error:`, err.message, '\nstderr:', (stderr || '').slice(0, 500));
    return {
      configured: true,
      host: ip,
      error: errorMessage,
    };
  }
}

/**
 * GET /stats - RAM, disque (partitions principales), uptime pour Unraid et Synology
 */
router.get('/stats', async (req, res) => {
  try {
    const sshDir = RESTIC_SSH_DIR || '/home/graphandco/.ssh';

    const [unraid, synology] = await Promise.all([
      fetchNasStats(NAS_UNRAID_IP, NAS_UNRAID_SSH_USER, sshDir, 'unraid'),
      fetchNasStats(NAS_SYNOLOGY_IP, NAS_SYNOLOGY_SSH_USER, sshDir, 'synology'),
    ]);

    res.json({
      success: true,
      unraid,
      synology,
    });
  } catch (err) {
    console.error('nas stats error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors de la récupération des stats NAS',
    });
  }
});

module.exports = router;
