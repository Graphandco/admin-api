/**
 * Routes déploiement - lance les scripts deploy.sh des projets via une image Docker
 * avec gh + docker, suivi d'état via fichier JSON.
 */
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const {
  DEPLOY_PROJECTS_FILE,
  DEPLOY_RUNNER_IMAGE,
  GH_TOKEN,
  DOCKER_SOCKET_PATH,
} = require('../config');

const router = express.Router();

const STATUS_DIR = '/tmp';
const PROJECTS_FILE = DEPLOY_PROJECTS_FILE
  || path.join(__dirname, '..', 'deploy-projects.json');

function getStatusPath(projectId) {
  return path.join(STATUS_DIR, `deploy-${projectId}.json`);
}

async function loadProjects() {
  const data = await fs.readFile(PROJECTS_FILE, 'utf8');
  const json = JSON.parse(data);
  return json.projects || [];
}

async function getProject(projectId) {
  const projects = await loadProjects();
  return projects.find((p) => p.id === projectId);
}

/** Durée (secondes) pendant laquelle success/error reste visible. Au-delà, effacé au prochain read (rechargement = statut idle). */
const STATUS_STALE_SECONDS = 60;

async function readStatus(projectId) {
  try {
    const p = getStatusPath(projectId);
    const data = await fs.readFile(p, 'utf8');
    const status = JSON.parse(data);
    if (status.status === 'success' || status.status === 'error') {
      const finished = status.finishedAt ? new Date(status.finishedAt).getTime() : 0;
      if (Date.now() - finished > STATUS_STALE_SECONDS * 1000) {
        await fs.unlink(p).catch(() => {});
        return null;
      }
    }
    return status;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeStatus(projectId, status) {
  const p = getStatusPath(projectId);
  await fs.writeFile(p, JSON.stringify(status, null, 2), 'utf8');
}

function runDeploy(projectId, projectPath, projectLabel) {
  const fullPath = projectPath;
  const mountBase = path.dirname(path.dirname(fullPath));
  const relativePath = path.relative(mountBase, fullPath);
  const containerWorkDir = path.join('/home/graphandco/www/docker-stack', relativePath);

  const args = [
    'run', '--rm',
    '-v', `${mountBase}:/home/graphandco/www/docker-stack:rw`,
    '-v', `${DOCKER_SOCKET_PATH || '/var/run/docker.sock'}:/var/run/docker.sock`,
    '-w', containerWorkDir,
    '-e', 'HOME=/home/graphandco',
    ...(GH_TOKEN ? ['-e', `GH_TOKEN=${GH_TOKEN}`] : []),
    DEPLOY_RUNNER_IMAGE,
    './deploy.sh',
  ];

  const proc = spawn('docker', args, {
    env: { ...process.env, HOME: '/home/graphandco' },
    cwd: '/',
  });

  let output = '';
  let errOut = '';

  proc.stdout.on('data', (d) => {
    const chunk = d.toString();
    output += chunk;
  });
  proc.stderr.on('data', (d) => {
    const chunk = d.toString();
    errOut += chunk;
  });

  proc.on('close', (code) => {
    const status = {
      projectId,
      projectLabel,
      status: code === 0 ? 'success' : 'error',
      startedAt: null,
      finishedAt: new Date().toISOString(),
      output: (output + errOut).slice(-8000),
      error: code !== 0 ? `Exit code ${code}` : null,
    };
    readStatus(projectId).then((prev) => {
      if (prev?.startedAt) status.startedAt = prev.startedAt;
      writeStatus(projectId, status);
    }).catch(() => writeStatus(projectId, status));
  });

  proc.on('error', (err) => {
    writeStatus(projectId, {
      projectId,
      projectLabel,
      status: 'error',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      output: errOut,
      error: err.message,
    });
  });
}

/**
 * GET /projects - Liste des projets déployables
 */
router.get('/projects', async (req, res) => {
  try {
    const projects = await loadProjects();
    res.json({ success: true, projects });
  } catch (err) {
    console.error('deploy projects list error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /:projectId - Lance le déploiement
 */
router.post('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Projet inconnu' });
    }

    const current = await readStatus(projectId);
    if (current?.status === 'running') {
      return res.status(409).json({
        success: false,
        error: 'Un déploiement est déjà en cours',
      });
    }

    const fullPath = project.path;
    const relPath = fullPath.startsWith('/') ? fullPath.slice(1) : fullPath;
    const scriptPathHost = path.join('/hostfs', relPath, 'deploy.sh');
    try {
      await fs.access(scriptPathHost);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `deploy.sh introuvable dans ${project.path}`,
      });
    }

    await writeStatus(projectId, {
      projectId,
      projectLabel: project.label,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: '',
      error: null,
    });

    runDeploy(projectId, fullPath, project.label);

    res.json({ success: true, message: 'Déploiement lancé' });
  } catch (err) {
    console.error('deploy start error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /:projectId/runs - Liste des derniers workflow runs GitHub Actions
 */
router.get('/:projectId/runs', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Projet inconnu' });
    }
    const repo = project.repo;
    if (!repo) {
      return res.json({ success: true, runs: [] });
    }
    if (!GH_TOKEN) {
      return res.json({ success: true, runs: [] });
    }
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?per_page=30`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${GH_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!resp.ok) {
      console.error('GitHub API error:', resp.status, await resp.text());
      return res.json({ success: true, runs: [] });
    }
    const data = await resp.json();
    const runs = (data.workflow_runs || [])
      .map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        displayTitle: r.display_title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
        headBranch: r.head_branch,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
    res.json({ success: true, runs });
  } catch (err) {
    console.error('deploy runs error:', err.message);
    res.json({ success: true, runs: [] });
  }
});

/**
 * GET /:projectId/status - État du dernier déploiement
 * readStatus efface déjà success/error après STATUS_STALE_SECONDS.
 */
router.get('/:projectId/status', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Projet inconnu' });
    }
    const status = await readStatus(projectId);
    res.json({
      success: true,
      status: status || { status: 'idle', projectId, projectLabel: project.label },
    });
  } catch (err) {
    console.error('deploy status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
