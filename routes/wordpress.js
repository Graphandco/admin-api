/**
 * Routes WordPress - infos multisite via WP-CLI
 */

const express = require('express');
const { wpCliExec } = require('../lib/wp-cli');

const router = express.Router();

/**
 * GET /sites - Liste tous les sites du multisite (avec nom via blogname)
 */
router.get('/sites', async (req, res) => {
  try {
    const { stdout, stderr, exitCode } = await wpCliExec(['site', 'list'], { format: 'json' });
    if (exitCode !== 0) {
      return res.status(500).json({
        success: false,
        error: 'Erreur WP-CLI',
        stderr: stderr || undefined,
        exitCode,
      });
    }
    let sites = [];
    try {
      sites = stdout ? JSON.parse(stdout) : [];
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Réponse WP-CLI invalide (JSON attendu)',
        raw: stdout,
      });
    }
    // Récupérer le nom de chaque site (wp option get blogname)
    const concurrency = 5;
    for (let i = 0; i < sites.length; i += concurrency) {
      const batch = sites.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (site) => {
          const { stdout, exitCode } = await wpCliExec(
            ['option', 'get', 'blogname'],
            { url: site.url, format: false }
          );
          site.site_name = exitCode === 0 && stdout ? stdout.trim() : null;
        })
      );
    }
    res.json({ success: true, count: sites.length, sites });
  } catch (err) {
    console.error('wp site list error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des sites',
      message: err.message,
    });
  }
});

/**
 * GET /info - Informations générales (version WP, multisite, siteurl)
 */
router.get('/info', async (req, res) => {
  try {
    const [coreInfo, optionRes] = await Promise.all([
      wpCliExec(['core', 'version']),
      wpCliExec(['option', 'get', 'siteurl']),
    ]);
    const version = coreInfo.stdout?.trim() || null;
    const siteurl = optionRes.stdout?.trim() || null;
    const multisiteRes = await wpCliExec(['eval', "echo is_multisite() ? 'true' : 'false';"], { format: false });
    const multisite = multisiteRes.stdout === 'true';
    res.json({
      success: true,
      version,
      siteurl,
      multisite,
    });
  } catch (err) {
    console.error('wp info error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des infos',
      message: err.message,
    });
  }
});

/**
 * GET /plugins - Liste des plugins (optionnel: ?url= pour cibler un site du multisite)
 */
router.get('/plugins', async (req, res) => {
  try {
    const url = req.query.url; // ex: https://sites.graphandco.net/site1/
    const status = req.query.status; // ex: active (pour filtrer par site)
    const args = ['plugin', 'list', '--fields=name,title,status,version,update,update_version'];
    if (status) args.push(`--status=${status}`);
    const { stdout, stderr, exitCode } = await wpCliExec(args, {
      url: url || undefined,
    });
    if (exitCode !== 0) {
      const errMsg = (stderr && stderr.trim()) || 'Erreur WP-CLI';
      console.error('wp plugin list failed', { url, exitCode, stderr: stderr?.slice(0, 500) });
      return res.status(500).json({
        success: false,
        error: errMsg,
        stderr: stderr || undefined,
        exitCode,
      });
    }
    let plugins = [];
    try {
      plugins = stdout ? JSON.parse(stdout) : [];
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Réponse WP-CLI invalide (JSON attendu)',
        raw: stdout,
      });
    }
    res.json({ success: true, count: plugins.length, plugins });
  } catch (err) {
    console.error('wp plugin list error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des plugins',
      message: err.message,
    });
  }
});

/**
 * GET /recent-changes - 5 dernières modifications (posts/pages) sur tout le multisite
 */
router.get('/recent-changes', async (req, res) => {
  try {
    // 1. Récupérer la liste des sites
    const sitesRes = await wpCliExec(['site', 'list'], { format: 'json' });
    if (sitesRes.exitCode !== 0) {
      return res.status(500).json({
        success: false,
        error: sitesRes.stderr || 'Erreur liste des sites',
      });
    }
    let sites = [];
    try {
      sites = sitesRes.stdout ? JSON.parse(sitesRes.stdout) : [];
    } catch {
      return res.status(500).json({ success: false, error: 'Réponse sites invalide' });
    }
    // 2. Pour chaque site, récupérer les 3 derniers posts/pages modifiés (3 à la fois pour limiter la charge)
    const args = ['post', 'list', '--post_type=post,page', '--post_status=publish', '--orderby=post_modified', '--order=DESC', '--posts_per_page=3', '--fields=ID,post_title,post_modified,post_type,url,post_author'];
    const concurrency = 3;
    const perSite = [];
    for (let i = 0; i < sites.length; i += concurrency) {
      const batch = sites.slice(i, i + concurrency);
      const batchRes = await Promise.all(
        batch.map(async (site) => {
          const { stdout, exitCode } = await wpCliExec(args, { url: site.url });
          if (exitCode !== 0) return [];
          try {
            const posts = stdout ? JSON.parse(stdout) : [];
            return posts.map((p) => ({ ...p, site_url: site.url, blog_id: site.blog_id }));
          } catch {
            return [];
          }
        })
      );
      perSite.push(...batchRes);
    }
    // 3. Fusionner, trier par date, garder les 5 premiers
    const merged = perSite.flat();
    merged.sort((a, b) => new Date(b.post_modified) - new Date(a.post_modified));
    const top5 = merged.slice(0, 5);

    // 4. Récupérer les noms d'auteurs (utilisateurs partagés en multisite)
    const authorIds = [...new Set(top5.map((p) => p.post_author).filter(Boolean))];
    const authorMap = {};
    for (const authorId of authorIds) {
      const { stdout, exitCode } = await wpCliExec(
        ['user', 'get', String(authorId), '--field=display_name'],
        { format: false }
      );
      authorMap[authorId] = exitCode === 0 && stdout ? stdout.trim() : null;
    }

    // 5. Récupérer les noms des sites (wp option get blogname)
    const siteUrls = [...new Set(top5.map((p) => p.site_url))];
    const siteNameMap = {};
    for (const siteUrl of siteUrls) {
      const { stdout, exitCode } = await wpCliExec(
        ['option', 'get', 'blogname'],
        { url: siteUrl, format: false }
      );
      siteNameMap[siteUrl] = exitCode === 0 && stdout ? stdout.trim() : null;
    }

    const changes = top5.map((p) => ({
      blog_id: p.blog_id,
      site_url: p.site_url,
      site_name: siteNameMap[p.site_url] || null,
      title: p.post_title,
      modified: p.post_modified,
      type: p.post_type,
      url: p.url || null,
      author: authorMap[p.post_author] || null,
    }));
    res.json({ success: true, count: changes.length, changes });
  } catch (err) {
    console.error('wp recent-changes error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des modifications récentes',
      message: err.message,
    });
  }
});

module.exports = router;
