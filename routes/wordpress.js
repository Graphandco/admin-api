/**
 * Routes WordPress - infos multisite via WP-CLI
 */

const express = require('express');
const { wpCliExec, execInContainer } = require('../lib/wp-cli');

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
 * GET /site-info - Infos d'un site (titre, logo, url) - ?url= obligatoire
 */
router.get('/site-info', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Paramètre url requis' });
    }
    const [nameRes, taglineRes, sitesRes] = await Promise.all([
      wpCliExec(['option', 'get', 'blogname'], { url, format: false }),
      wpCliExec(['option', 'get', 'blogdescription'], { url, format: false }),
      wpCliExec(['site', 'list'], { format: 'json' }),
    ]);
    const site_name = nameRes.exitCode === 0 && nameRes.stdout ? nameRes.stdout.trim() : null;
    const tagline = taglineRes.exitCode === 0 && taglineRes.stdout ? taglineRes.stdout.trim() : null;
    // Icône du site (Réglages > Général > Icône du site) - wp option get + wp post list
    let logo_url = null;
    try {
      const iconRes = await wpCliExec(['option', 'get', 'site_icon'], { url, format: false });
      if (iconRes.exitCode === 0 && iconRes.stdout) {
        const attachmentId = iconRes.stdout.trim();
        if (attachmentId && attachmentId !== '0') {
          const postRes = await wpCliExec(
            ['post', 'list', '--post_type=attachment', '--post__in=' + attachmentId, '--field=url'],
            { url, format: false }
          );
          if (postRes.exitCode === 0 && postRes.stdout) {
            logo_url = postRes.stdout.trim() || null;
          }
        }
      }
    } catch {
      // ignore
    }
    res.json({
      success: true,
      site_name,
      tagline: tagline || null,
      url,
      logo_url,
      admin_url: url.replace(/\/?$/, '') + '/wp-admin',
    });
  } catch (err) {
    console.error('wp site-info error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des infos du site',
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

/**
 * GET /connexions - 10 dernières connexions au backoffice (sessions actives)
 */
router.get('/connexions', async (req, res) => {
  try {
    const php = [
      '$site_map = [];',
      'if (is_multisite()) {',
      '  $sites = get_sites([\'number\' => 500]);',
      '  foreach ($sites as $site) {',
      '    $bid = (int) $site->blog_id;',
      '    switch_to_blog($bid);',
      '    $site_map[$bid] = [\'url\' => get_site_url($bid), \'name\' => get_bloginfo(\'name\') ?: get_site_url($bid)];',
      '    restore_current_blog();',
      '  }',
      '} else {',
      '  $site_map[1] = [\'url\' => home_url(), \'name\' => get_bloginfo(\'name\')];',
      '}',
      '$results = [];',
      '$users = get_users([\'number\' => 100]);',
      'foreach ($users as $user) {',
      '  $tokens = WP_Session_Tokens::get_instance($user->ID);',
      '  if (!$tokens) continue;',
      '  $sessions = $tokens->get_all();',
      '  $primary_blog = (int) get_user_meta($user->ID, \'primary_blog\', true) ?: 1;',
      '  foreach ($sessions as $s) {',
      '    if (!empty($s[\'login\'])) {',
      '      $bid = isset($s[\'blog_id\']) ? (int) $s[\'blog_id\'] : $primary_blog;',
      '      $site = $site_map[$bid] ?? null;',
      '      $results[] = [\'user\' => $user->display_name ?: $user->user_login, \'login\' => gmdate(\'c\', $s[\'login\']), \'site_url\' => $site ? $site[\'url\'] : null, \'site_name\' => $site ? $site[\'name\'] : null];',
      '    }',
      '  }',
      '}',
      'usort($results, function($a, $b) { return strcmp($b[\'login\'], $a[\'login\']); });',
      'echo json_encode(array_slice($results, 0, 10));',
    ].join(' ');
    const phpCode = php.replace(/\n/g, ' ').trim().replace(/\$/g, '\\$').replace(/"/g, '\\"');
    const { stdout, stderr, exitCode } = await wpCliExec(
      ['eval', `"${phpCode}"`],
      { format: false }
    );
    if (exitCode !== 0) {
      return res.status(500).json({
        success: false,
        error: 'Erreur WP-CLI',
        stderr: stderr || undefined,
        exitCode,
      });
    }
    let connexions = [];
    try {
      connexions = stdout ? JSON.parse(stdout) : [];
    } catch {
      connexions = [];
    }
    res.json({ success: true, count: connexions.length, connexions });
  } catch (err) {
    console.error('wp connexions error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des connexions',
      message: err.message,
    });
  }
});

/**
 * GET /site-stats - Statistiques par type de contenu + espace disque
 * ?url= optionnel : site ciblé ; absent = agrégat tout le multisite
 */
router.get('/site-stats', async (req, res) => {
  try {
    const url = req.query.url || null;

    // 1. Post types avec comptage
    let postTypes = [];
    if (url) {
      // Un seul site
      const { stdout, exitCode } = await wpCliExec(
        ['post-type', 'list', '--fields=name,label,count'],
        { url, format: 'json' }
      );
      if (exitCode !== 0) {
        return res.status(500).json({ success: false, error: 'Erreur post-type list' });
      }
      try {
        postTypes = stdout ? JSON.parse(stdout) : [];
      } catch {
        postTypes = [];
      }
    } else {
      // Agrégat multisite : récupérer sites, puis comptes par site
      const sitesRes = await wpCliExec(['site', 'list'], { format: 'json' });
      if (sitesRes.exitCode !== 0) {
        return res.status(500).json({ success: false, error: 'Erreur liste des sites' });
      }
      let sites = [];
      try {
        sites = sitesRes.stdout ? JSON.parse(sitesRes.stdout) : [];
      } catch {
        sites = [];
      }
      const countsByName = {};
      const labelsByName = {};
      const concurrency = 3;
      for (let i = 0; i < sites.length; i += concurrency) {
        const batch = sites.slice(i, i + concurrency);
        const batchRes = await Promise.all(
          batch.map(async (site) => {
            const { stdout, exitCode } = await wpCliExec(
              ['post-type', 'list', '--fields=name,label,count'],
              { url: site.url, format: 'json' }
            );
            if (exitCode !== 0) return [];
            try {
              return stdout ? JSON.parse(stdout) : [];
            } catch {
              return [];
            }
          })
        );
        for (const list of batchRes) {
          for (const pt of list) {
            const n = pt.name || pt.slug;
            const c = parseInt(pt.count, 10) || 0;
            countsByName[n] = (countsByName[n] || 0) + c;
            if (pt.label) labelsByName[n] = pt.label;
          }
        }
      }
      postTypes = Object.entries(countsByName).map(([name, count]) => ({
        name,
        label: labelsByName[name] || name,
        count: String(count),
      }));
    }

    // Filtrer les types internes + ceux avec 0 élément
    const skip = new Set(['revision', 'nav_menu_item', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_block', 'acf-field', 'acf-field-group']);
    const contentTypes = postTypes
      .filter((pt) => pt.name && !skip.has(pt.name) && (parseInt(pt.count, 10) || 0) >= 1)
      .sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));

    // 2. Espace disque
    let diskUsed = null;
    if (url) {
      // Trouver blog_id pour le chemin uploads
      const sitesRes = await wpCliExec(['site', 'list'], { format: 'json' });
      let sites = [];
      try {
        sites = sitesRes.stdout ? JSON.parse(sitesRes.stdout) : [];
      } catch {}
      const site = sites.find((s) => s.url === url);
      const blogId = site ? String(site.blog_id) : null;
      let path;
      if (blogId === '1') {
        path = '/var/www/html/wp-content/uploads';
      } else if (blogId) {
        path = `/var/www/html/wp-content/uploads/sites/${blogId}`;
      } else {
        path = '/var/www/html/wp-content';
      }
      const duRes = await execInContainer(`du -sh ${path} 2>/dev/null`);
      if (duRes.exitCode === 0 && duRes.stdout) {
        diskUsed = duRes.stdout.split(/\s+/)[0] || null;
      }
    } else {
      const duRes = await execInContainer('du -sh /var/www/html/wp-content 2>/dev/null');
      if (duRes.exitCode === 0 && duRes.stdout) {
        diskUsed = duRes.stdout.split(/\s+/)[0] || null;
      }
    }

    res.json({
      success: true,
      content_types: contentTypes,
      disk_used: diskUsed,
    });
  } catch (err) {
    console.error('wp site-stats error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques',
      message: err.message,
    });
  }
});

module.exports = router;
