# Tâches cron – métriques VPS

Les métriques VPS (CPU, RAM, disque) sont collectées toutes les 15 minutes et conservées 7 jours. La suppression des données dépassant 7 jours est effectuée automatiquement à chaque collecte.

## 1. Collecte des métriques (toutes les 15 min)

```cron
*/15 * * * * curl -s -H "X-API-Key: VOTRE_ADMIN_API_KEY" http://127.0.0.1:3009/api/system/collect-metrics
```

Remplacez :
- `VOTRE_ADMIN_API_KEY` par la valeur de `ADMIN_API_KEY` de votre `.env`
- `127.0.0.1:3009` par l’URL/host du conteneur admin-api (ex. `admin-api:3000` si le cron tourne dans un conteneur sur le même réseau)

## 2. Suppression des données > 7 jours

Aucune tâche cron dédiée : la route `/api/system/collect-metrics` exécute un `DELETE` avant chaque insertion. Les données de plus de 7 jours sont automatiquement supprimées.

---

### Installation

```bash
crontab -e
```

Ajoutez la ligne du cron de collecte, puis sauvegardez.

### Vérification

- Collecte : `curl -s -H "X-API-Key: ..." http://127.0.0.1:3009/api/system/collect-metrics`
- L’historique apparaît sur la page Stats VPS après quelques collectes.

### Table MySQL

La table `vps_metrics` est créée automatiquement au premier appel de `/api/system/collect-metrics`.  
Pour une création manuelle : `mysql -u USER -p MYSQL_DATABASE < migrations/vps_metrics.sql`
