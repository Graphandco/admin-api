/**
 * Routes scripts système - exécution sur l'hôte
 */

const express = require('express');
const { runHostScript } = require('../lib/scripts');

const router = express.Router();

/**
 * GET /server-status - Exécute server-status.sh sur l'hôte
 */
router.get('/server-status', async (req, res) => {
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
      error: "Erreur lors de l'exécution du script",
      message: err.message,
      stdout: err.stdout,
      stderr: err.stderr,
    });
  }
});

module.exports = router;
