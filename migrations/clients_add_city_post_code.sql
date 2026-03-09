-- Ajouter post_code et city à la table clients
-- Exécuter : mysql -u USER -p DATABASE < migrations/clients_add_city_post_code.sql

ALTER TABLE clients ADD COLUMN post_code VARCHAR(20) DEFAULT '' AFTER adresse;
ALTER TABLE clients ADD COLUMN city VARCHAR(255) DEFAULT '' AFTER post_code;
