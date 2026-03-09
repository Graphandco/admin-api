-- Table invoices pour lier les factures PDF aux clients
-- Exécuter : mysql -u USER -p DATABASE < migrations/invoices.sql

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  invoice_number VARCHAR(100) NOT NULL DEFAULT '',
  filename VARCHAR(255) NOT NULL,
  total_ttc DECIMAL(12,2) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);
