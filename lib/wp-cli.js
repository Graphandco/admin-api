/**
 * Exécution de commandes WP-CLI via docker exec
 * @see https://make.wordpress.org/cli/handbook/references/internal-api/
 * @see https://developer.wordpress.org/cli/commands/
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { WP_CLI_CONTAINER } = require('../config');

const execAsync = promisify(exec);

/**
 * Exécute une commande WP-CLI dans le conteneur wordpress-wpcli.
 * @param {string[]} args - Arguments WP-CLI (ex: ['site', 'list'])
 * @param {{ format?: string|false, url?: string }} options
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function wpCliExec(args, options = {}) {
  const format = options.format !== false ? (options.format || 'json') : null;
  const url = options.url;
  const parts = ['wp', ...args];
  if (format) parts.push(`--format=${format}`);
  if (url) {
    // Échapper l'URL pour le shell (caractères spéciaux, espaces, etc.)
    const escaped = url.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    parts.push(`--url='${escaped}'`);
  }
  parts.push('--allow-root');
  const cmd = `docker exec ${WP_CLI_CONTAINER} ${parts.join(' ')}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout?.trim() || '',
      stderr: err.stderr?.trim() || err.message || '',
      exitCode: err.code ?? 1,
    };
  }
}

module.exports = { wpCliExec };
