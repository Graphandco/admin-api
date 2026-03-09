-- Supprimer la colonne is_backoffice de la table websites
-- Exécuter : mysql -u USER -p admin_api < migrations/websites_drop_is_backoffice.sql

ALTER TABLE websites DROP COLUMN is_backoffice;
