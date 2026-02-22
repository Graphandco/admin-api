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
};
