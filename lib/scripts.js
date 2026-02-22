/**
 * Exécution de scripts système sur l'hôte via conteneur temporaire
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { SCRIPTS_PATH, DOCKER_SOCKET_PATH, SCRIPT_TIMEOUT_MS } = require('../config');

const execAsync = promisify(exec);

const ALLOWED_SCRIPTS = ['server-status.sh'];

/**
 * Exécute un script sur l'hôte via un conteneur temporaire (chroot).
 * @param {string} scriptName - Nom du script (doit être dans ALLOWED_SCRIPTS)
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runHostScript(scriptName) {
  if (!ALLOWED_SCRIPTS.includes(scriptName)) {
    throw new Error(`Script non autorisé: ${scriptName}`);
  }
  const scriptPath = `${SCRIPTS_PATH}/${scriptName}`;
  const escapedPath = scriptPath.replace(/'/g, "'\\''");
  const cmd = `docker run --rm \
    -v /:/host:ro \
    -v /proc:/proc:ro \
    -v /sys:/sys:ro \
    -v ${DOCKER_SOCKET_PATH}:/var/run/docker.sock \
    docker:cli \
    sh -c "chroot /host '${escapedPath}'"`;
  const { stdout, stderr } = await execAsync(cmd, {
    timeout: SCRIPT_TIMEOUT_MS,
    env: { ...process.env, DOCKER_HOST: `unix://${DOCKER_SOCKET_PATH}` },
  });
  return { stdout: stdout.trim(), stderr: stderr?.trim() || '' };
}

module.exports = { runHostScript, ALLOWED_SCRIPTS };
