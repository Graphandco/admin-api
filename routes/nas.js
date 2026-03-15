/**
 * Routes monitoring NAS Unraid (RAM, CPU, uptime via SSH)
 * Utilise RESTIC_SSH_DIR pour les clés SSH, NAS_IP et NAS_SSH_USER du .env.
 * Exécute SSH dans un conteneur Alpine avec --network host (Tailscale).
 */
const express = require('express');
const { spawn } = require('child_process');
const { NAS_IP, NAS_SSH_USER, RESTIC_SSH_DIR } = require('../config');

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
  // free -m : Mem: total used free shared buff/cache available
  const line = stdout.split('\n').find((l) => l.startsWith('Mem:'));
  if (!line) return { total: 0, used: 0, available: 0, percent: 0 };
  const parts = line.split(/\s+/).filter(Boolean);
  const total = parseInt(parts[1], 10) * 1024 * 1024; // MB -> bytes
  const used = parseInt(parts[2], 10) * 1024 * 1024;
  const available = parseInt(parts[6], 10) * 1024 * 1024;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { total, used, available, percent };
}

function parseLoadavg(stdout) {
  // loadavg: 1.2 1.1 1.0 1/123 45678
  const parts = stdout.trim().split(/\s+/);
  return {
    load1: parseFloat(parts[0]) || 0,
    load5: parseFloat(parts[1]) || 0,
    load15: parseFloat(parts[2]) || 0,
  };
}

function parseUptime(stdout) {
  // proc/uptime: 12345.67 12340.00
  const match = stdout.trim().match(/^(\d+(?:\.\d+)?)/);
  return match ? Math.floor(parseFloat(match[1])) : 0;
}

/**
 * GET /stats - RAM, CPU (loadavg), uptime du NAS Unraid
 */
router.get('/stats', async (req, res) => {
  try {
    if (!NAS_IP) {
      return res.json({
        success: true,
        configured: false,
        message: 'NAS_IP non configuré dans .env (ex: 100.84.122.48)',
      });
    }

    const sshDir = RESTIC_SSH_DIR || '/home/graphandco/.ssh';
    const user = NAS_SSH_USER || 'root';

    const cmd = "free -m | head -2; echo '---LOAD---'; cat /proc/loadavg; echo '---UPTIME---'; cat /proc/uptime";
    const { stdout } = await runSshCmd(sshDir, user, NAS_IP, cmd);

    const [memBlock, rest] = stdout.split('---LOAD---').map((s) => s.trim());
    const [loadPart, uptimePart] = (rest || '').split('---UPTIME---').map((s) => s.trim());

    const mem = parseFree(memBlock || '');
    const loadavg = parseLoadavg(loadPart || '');
    const uptimeSeconds = parseUptime(uptimePart || '0');

    const formatBytes = (bytes) => {
      if (!bytes || bytes < 1024) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    };

    res.json({
      success: true,
      configured: true,
      host: NAS_IP,
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
        loadavg: {
          load1: loadavg.load1,
          load5: loadavg.load5,
          load15: loadavg.load15,
        },
      },
    });
  } catch (err) {
    const stderr = err.stderr || err.message || '';
    const combined = [err.message, stderr].filter(Boolean).join('\n');

    const isAuth = /permission denied|publickey|authentication failed/i.test(combined);
    const isNetwork = /connection refused|no route|timeout|network|unreachable|econnrefused/i.test(combined);

    let message = 'Erreur lors de la récupération des stats NAS';
    if (isAuth) message = 'SSH : clé refusée (vérifiez authorized_keys sur le NAS)';
    else if (isNetwork) message = 'Impossible de joindre le NAS (Tailscale ? NAS_IP ?)';

    console.error('nas stats error:', err.message, '\nstderr:', (stderr || '').slice(0, 500));
    res.status(500).json({
      success: false,
      error: message,
      stderr: (stderr || '').slice(0, 500),
    });
  }
});

module.exports = router;
