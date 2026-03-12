/**
 * Configuration centralisée - variables d'environnement
 */
module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  SCRIPTS_PATH: process.env.SCRIPTS_PATH || '/home/graphandco/monitoring',
  DOCKER_SOCKET_PATH: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  SCRIPT_TIMEOUT_MS: parseInt(process.env.SCRIPT_TIMEOUT_MS || '60000', 10),
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  WP_CLI_CONTAINER: process.env.WP_CLI_CONTAINER || 'wordpress-wpcli',
  MYSQL_HOST: process.env.MYSQL_HOST || 'mysql',
  MYSQL_USER: process.env.MYSQL_USER || 'root',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || '',
  METRICS_TIMEZONE: process.env.METRICS_TIMEZONE || 'Europe/Paris',
  RESTIC_REPOSITORY: (process.env.RESTIC_REPOSITORY || '').trim().replace(/^["']|["']$/g, ''),
  RESTIC_PASSWORD: (process.env.RESTIC_PASSWORD || '').trim(),
  RESTIC_PASSWORD_FILE: process.env.RESTIC_PASSWORD_FILE || '', // Chemin sur l'hôte (prioritaire si défini)
  RESTIC_SSH_DIR: process.env.RESTIC_SSH_DIR || '/home/graphandco/.ssh',
};
