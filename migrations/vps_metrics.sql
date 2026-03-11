-- Historique des métriques VPS (CPU, RAM, disque)
-- Rétention : 7 jours. Collecte prévue toutes les 15 min via cron.
--
-- Exécuter : mysql -u USER -p MYSQL_DATABASE < migrations/vps_metrics.sql

CREATE TABLE IF NOT EXISTS vps_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cpu_percent TINYINT UNSIGNED,
  mem_used BIGINT UNSIGNED,
  mem_total BIGINT UNSIGNED,
  disk_used BIGINT UNSIGNED,
  disk_total BIGINT UNSIGNED
);

CREATE INDEX idx_vps_metrics_ts ON vps_metrics(ts);
