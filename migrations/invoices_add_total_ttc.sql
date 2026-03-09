-- Ajouter la colonne total_ttc à la table invoices
-- Exécuter : mysql -u USER -p DATABASE < migrations/invoices_add_total_ttc.sql

ALTER TABLE invoices ADD COLUMN total_ttc DECIMAL(12,2) DEFAULT NULL;
