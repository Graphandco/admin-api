-- Table clients pour l'admin-api
-- Exécuter : mysql -u USER -p DATABASE < migrations/clients.sql
-- ATTENTION : DROP supprime toutes les données existantes

DROP TABLE IF EXISTS clients;

CREATE TABLE clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  company VARCHAR(255) DEFAULT '',
  email VARCHAR(255) DEFAULT '',
  website VARCHAR(500) DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  adresse VARCHAR(1000) DEFAULT '',
  payment_date DATE DEFAULT NULL,
  annual_cost DECIMAL(12,2) DEFAULT NULL,
  creation_cost DECIMAL(12,2) DEFAULT NULL,
  invoice TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
