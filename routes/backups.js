/**
 * Routes sauvegardes Restic - liste des snapshots disponibles
 * Utilise le .env du monitoring (même que le script backup) pour éviter les problèmes
 * de transmission du mot de passe dans les conteneurs Docker.
 * Utilise --network host pour accéder au NAS via Tailscale.
 */
const express = require('express');
const { spawn } = require('child_process');
const { SCRIPTS_PATH, RESTIC_SSH_DIR } = require('../config');

const router = express.Router();

function runResticCmd(sshDir, monitoringDir, cmd) {
  return new Promise((resolve, reject) => {
    const args = [
      'run', '--rm', '--network', 'host',
      '--entrypoint', 'sh',
      '-v', `${sshDir}:/root/.ssh:ro`,
      '-v', `${monitoringDir}:/mnt:ro`,
      '-w', '/mnt',
      'restic/restic',
      '-c', `set -a && . .env 2>/dev/null || true && set +a && ${cmd}`,
    ];

    const proc = spawn('docker', args, { env: process.env });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`restic failed: ${cmd}`), { code, stderr }));
    });
  });
}

function parseStatsOutput(stdout, stderr) {
  const text = stdout + stderr;
  const sizeMatch = text.match(/Total Size:\s*([\d.]+\s*[KMGT]?i?B)/i);
  const countMatch = text.match(/Total File Count:\s*(\d+)/i);
  return {
    total_size: sizeMatch ? sizeMatch[1].trim() : null,
    total_file_count: countMatch ? parseInt(countMatch[1], 10) : null,
  };
}

/**
 * GET /snapshots - Liste des snapshots Restic depuis le dépôt (VPS → NAS)
 * ?withStats=true : récupère aussi taille et nb fichiers (lent, N appels restic stats)
 * Sans withStats : rapide, snapshots uniquement.
 */
router.get('/snapshots', async (req, res) => {
  const withStats = req.query.withStats === 'true';
  try {
    if (!SCRIPTS_PATH) {
      return res.json({
        success: true,
        configured: false,
        snapshots: [],
        message: 'SCRIPTS_PATH non configuré. Le .env du monitoring (RESTIC_*) doit exister.',
      });
    }

    const sshDir = RESTIC_SSH_DIR || '/home/graphandco/.ssh';
    const { stdout, stderr } = await runResticCmd(sshDir, SCRIPTS_PATH, 'restic snapshots --json');

    let snapshots = [];
    try {
      snapshots = stdout ? JSON.parse(stdout.trim()) : [];
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Réponse Restic invalide (JSON attendu)',
        stderr: stderr || undefined,
      });
    }

    // Sans withStats : rapide. Avec withStats : récupère taille pour chaque snapshot (lent)
    const result = snapshots.map((s) => ({
      id: s.id,
      short_id: s.short_id,
      time: s.time,
      parent: s.parent,
      paths: s.paths || [],
      hostname: s.hostname,
      tags: s.tags || [],
      username: s.username,
      excludes: s.excludes || [],
      total_size: null,
      total_file_count: null,
    }));

    if (withStats && snapshots.length > 0) {
      await Promise.all(
        snapshots.map(async (s, i) => {
          try {
            const { stdout: statsOut, stderr: statsErr } = await runResticCmd(
              sshDir, SCRIPTS_PATH, `restic stats ${s.short_id}`
            );
            const stats = parseStatsOutput(statsOut, statsErr);
            result[i].total_size = stats.total_size;
            result[i].total_file_count = stats.total_file_count;
          } catch {
            // Stats optionnels pour ce snapshot
          }
        })
      );
    }

    res.json({
      success: true,
      configured: true,
      count: result.length,
      snapshots: result,
    });
  } catch (err) {
    const stderr = err.stderr || err.stdout || err.message || '';
    const stderrStr = typeof stderr === 'string' ? stderr : String(stderr || '');
    const combined = [err.message, stderrStr].filter(Boolean).join('\n');

    const isAuth = /wrong password|invalid repository|permission denied|bad password/i.test(combined);
    const isNetwork = /connection refused|no route|timeout|network|unreachable|econnrefused/i.test(combined);
    const isDocker = /cannot connect to the docker daemon|permission denied.*docker|no such file or directory/i.test(combined);
    const isSsh = /host key verification failed|unable to start the sftp session|unexpected eof/i.test(combined);

    let message = 'Erreur lors de la récupération des snapshots';
    if (isAuth) message = 'Mot de passe ou dépôt Restic invalide';
    else if (isSsh) message = 'Erreur SSH/SFTP vers le NAS (Host key verification failed, montage .ssh manquant ?)';
    else if (isNetwork) message = 'Impossible de joindre le dépôt (NAS / Tailscale ?)';
    else if (isDocker) message = 'Impossible de lancer Docker (socket, permissions ?)';

    console.error('restic snapshots error:', err.message, '\nstderr:', stderrStr.slice(0, 500));
    res.status(500).json({
      success: false,
      error: message,
      stderr: stderrStr.slice(0, 1000),
      code: err.code,
    });
  }
});

module.exports = router;
