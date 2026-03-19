/**
 * Admin API - Gateway légère pour Docker, monitoring et WordPress
 */
require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const { PORT, ADMIN_API_KEY } = require('./config');

const dockerRoutes = require('./routes/docker');
const scriptsRoutes = require('./routes/scripts');
const wordpressRoutes = require('./routes/wordpress');
const clientsRoutes = require('./routes/clients');
const invoicesRoutes = require('./routes/invoices');
const contractsRoutes = require('./routes/contracts');
const quotesRoutes = require('./routes/quotes');
const sitesRoutes = require('./routes/sites');
const systemRoutes = require('./routes/system');
const backupsRoutes = require('./routes/backups');
const nasRoutes = require('./routes/nas');
const deployRoutes = require('./routes/deploy');

const app = express();

// Rate limiting: 100 requêtes/minute par IP sur /api
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(express.json());

/**
 * Authentification par clé API (X-API-Key ou Authorization: Bearer)
 * /health reste accessible sans authentification
 */
function requireApiKey(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: 'API key non configurée' });
  }
  const apiKey =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

// Rate limiting + auth sur /api
app.use('/api', apiLimiter, requireApiKey);

// Santé de l'API (accessible sans clé pour healthchecks)
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'admin-api' });
});

// Routes par domaine
app.use('/api/docker', dockerRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/wordpress', wordpressRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/nas', nasRoutes);
app.use('/api/deploy', deployRoutes);

// 404
app.use((_, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Démarrage
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Admin API listening on port ${PORT}`);
});
