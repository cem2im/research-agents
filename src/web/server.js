import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';
import { getDatabase } from '../db/database.js';
import { getAgent } from '../agents/index.js';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });
const app = express();
const PORT = process.env.PORT || 3000;

// Password protection
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'research2024';
const sessions = new Map();

app.use(express.json());

// Request logging for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check endpoint - must respond quickly for Railway
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Root path - explicit handler
app.get('/', (req, res, next) => {
  next(); // Let static middleware handle it
});

// Auth middleware - check session token
const authMiddleware = (req, res, next) => {
  // Allow auth endpoints and health check
  if (req.path === '/api/auth/login' || req.path === '/api/auth/check' || req.path === '/health') {
    return next();
  }

  // Check for session token
  const token = req.headers['x-session-token'];
  if (token && sessions.has(token)) {
    return next();
  }

  // For HTML pages, let them load (auth check happens client-side)
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
};

app.use(authMiddleware);
app.use(express.static(join(__dirname, 'public')));

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === DASHBOARD_PASSWORD) {
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessions.set(token, { createdAt: Date.now() });
    // Clean old sessions (older than 24h)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [t, s] of sessions) {
      if (s.createdAt < dayAgo) sessions.delete(t);
    }
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token && sessions.has(token)) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// API Routes
app.get('/api/stats', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/discoveries', async (req, res) => {
  try {
    const db = await getDatabase();
    const limit = parseInt(req.query.limit) || 20;
    const results = db.all(`
      SELECT * FROM discoveries
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);
    res.json(results.map(r => ({
      ...r,
      authors: JSON.parse(r.authors || '[]'),
      keywords: JSON.parse(r.keywords || '[]')
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/hypotheses', async (req, res) => {
  try {
    const db = await getDatabase();
    const results = db.all(`
      SELECT h.*, d.title as discovery_title
      FROM hypotheses h
      LEFT JOIN discoveries d ON h.discovery_id = d.id
      ORDER BY h.created_at DESC
      LIMIT 20
    `);
    res.json(results.map(r => ({
      ...r,
      assumptions: JSON.parse(r.assumptions || '[]'),
      testable_predictions: JSON.parse(r.testable_predictions || '[]')
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update hypothesis (for editing before validation)
app.put('/api/hypotheses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, statement, rationale, assumptions, testable_predictions, status } = req.body;
    const db = await getDatabase();

    db.updateHypothesis(id, {
      title, statement, rationale, assumptions, testable_predictions, status
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate hypotheses only (without validation) - for review/edit step
app.post('/api/hypotheses/generate', async (req, res) => {
  try {
    const { discoveryIds } = req.body;
    const db = await getDatabase();
    const oracle = getAgent('oracle');
    const triage = getAgent('triage');

    let discoveries = [];

    if (discoveryIds && discoveryIds.length > 0) {
      for (const id of discoveryIds) {
        const d = db.get('SELECT * FROM discoveries WHERE id = ?', [id]);
        if (d) {
          discoveries.push({
            ...d,
            authors: JSON.parse(d.authors || '[]'),
            keywords: JSON.parse(d.keywords || '[]')
          });
        }
      }
    } else {
      const rows = db.all('SELECT * FROM discoveries WHERE processed = 0 ORDER BY created_at DESC LIMIT 10');
      discoveries = rows.map(d => ({
        ...d,
        authors: JSON.parse(d.authors || '[]'),
        keywords: JSON.parse(d.keywords || '[]')
      }));
    }

    if (discoveries.length === 0) {
      return res.json({ success: true, hypothesesGenerated: 0, hypotheses: [] });
    }

    console.log(`\n💡 Generating hypotheses for ${discoveries.length} discoveries...`);

    // Triage first
    const triageResult = await triage.scoreDiscoveries(discoveries);
    const highPriority = (triageResult?.scores || []).filter(s => s.priority === 'high' || s.priority === 'medium');

    const allHypotheses = [];
    for (const scored of highPriority.slice(0, 5)) {
      const discovery = discoveries.find(d => d.id === scored.discovery_id);
      if (!discovery) continue;

      try {
        const hypotheses = await oracle.generateHypotheses(discovery);
        allHypotheses.push(...hypotheses.map(h => ({ ...h, discovery_title: discovery.title })));
      } catch (e) {
        console.error(`Error generating hypotheses for ${discovery.id}:`, e.message);
      }
    }

    console.log(`✅ Generated ${allHypotheses.length} hypotheses (pending review)`);

    res.json({
      success: true,
      hypothesesGenerated: allHypotheses.length,
      hypotheses: allHypotheses
    });
  } catch (e) {
    console.error('Hypothesis generation error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Validate a single hypothesis (after editing)
app.post('/api/hypotheses/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();
    const sage = getAgent('sage');
    const architect = getAgent('architect');

    const hypothesis = db.getHypothesis(id);
    if (!hypothesis) {
      return res.status(404).json({ error: 'Hypothesis not found' });
    }

    console.log(`\n🔬 Validating hypothesis: ${hypothesis.title}...`);

    const validation = await sage.validateHypothesis(hypothesis);
    let projectCreated = false;

    if (validation && (validation.recommendation === 'pursue' || validation.recommendation === 'modify')) {
      const project = await architect.designProject(hypothesis, validation);
      if (project) {
        projectCreated = true;
      }
    }

    // Mark hypothesis as validated
    db.updateHypothesisStatus(id, 'validated');

    res.json({
      success: true,
      validation,
      projectCreated
    });
  } catch (e) {
    console.error('Validation error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const db = await getDatabase();
    const results = db.all(`
      SELECT p.*, h.title as hypothesis_title
      FROM projects p
      LEFT JOIN hypotheses h ON p.hypothesis_id = h.id
      ORDER BY p.created_at DESC
      LIMIT 20
    `);
    res.json(results.map(r => ({
      ...r,
      milestones: JSON.parse(r.milestones || '[]'),
      resources_required: JSON.parse(r.resources_required || '[]')
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/memory', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getAllMemory());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/memory', async (req, res) => {
  try {
    const db = await getDatabase();
    const id = db.addMemory(req.body);
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getRecentActivity(30));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const db = await getDatabase();
    const { entityType, entityId, rating, useful, notes } = req.body;
    const id = db.addFeedback(entityType, entityId, { rating, useful, notes });
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    const scout = getAgent('scout');
    const { results, errors } = await scout.searchQuery(query, { sources: ['pubmed'] });
    res.json({ results, errors, count: results.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/schedule', async (req, res) => {
  try {
    const { readFileSync } = await import('fs');
    const schedulePath = join(process.env.WORKSPACE_ROOT || '.', 'config', 'schedule.json');
    const schedule = JSON.parse(readFileSync(schedulePath, 'utf-8'));
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];
    res.json({ schedule, today });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all domains for the run panel
app.get('/api/domains', async (req, res) => {
  try {
    const db = await getDatabase();
    const domains = db.getActiveDomains();
    res.json(domains);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run a scan for a specific domain
app.post('/api/run', async (req, res) => {
  try {
    const { domainId, daysBack = 30 } = req.body;
    const db = await getDatabase();
    const scout = getAgent('scout');

    // Validate daysBack (min 7, max 365)
    const days = Math.max(7, Math.min(365, parseInt(daysBack) || 30));

    let results = [];
    let domainName = '';

    if (domainId === 'all') {
      // Scan all domains
      const domains = db.getActiveDomains();
      for (const domain of domains) {
        const domainResults = await scout.searchDomain(domain, days);
        results.push(...domainResults);
      }
      domainName = 'All Domains';
    } else {
      // Scan specific domain
      const domain = db.getDomain(domainId);
      if (!domain) {
        return res.status(404).json({ error: 'Domain not found' });
      }
      results = await scout.searchDomain(domain, days);
      domainName = domain.name;
    }

    res.json({
      success: true,
      domain: domainName,
      count: results.length,
      results: results.slice(0, 10) // Return first 10 for preview
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run pipeline on specific discoveries or all unprocessed
app.post('/api/pipeline', async (req, res) => {
  try {
    const { discoveryIds } = req.body;
    const db = await getDatabase();

    // Import agents
    const triage = getAgent('triage');
    const oracle = getAgent('oracle');
    const sage = getAgent('sage');
    const architect = getAgent('architect');

    let discoveries = [];

    if (discoveryIds && discoveryIds.length > 0) {
      // Get specific discoveries
      for (const id of discoveryIds) {
        const d = db.get('SELECT * FROM discoveries WHERE id = ?', [id]);
        if (d) {
          discoveries.push({
            ...d,
            authors: JSON.parse(d.authors || '[]'),
            keywords: JSON.parse(d.keywords || '[]')
          });
        }
      }
    } else {
      // Get all unprocessed discoveries
      const rows = db.all('SELECT * FROM discoveries WHERE processed = 0 ORDER BY created_at DESC LIMIT 20');
      discoveries = rows.map(d => ({
        ...d,
        authors: JSON.parse(d.authors || '[]'),
        keywords: JSON.parse(d.keywords || '[]')
      }));
    }

    if (discoveries.length === 0) {
      return res.json({
        success: true,
        hypothesesGenerated: 0,
        validated: 0,
        projectsCreated: 0,
        message: 'No discoveries to process'
      });
    }

    console.log(`\n🧠 Running pipeline on ${discoveries.length} discoveries...`);

    // Stage 1: Triage
    console.log('  ⚖️ Triaging...');
    const triageResult = await triage.scoreDiscoveries(discoveries);
    const highPriority = (triageResult?.scores || []).filter(s => s.priority === 'high' || s.priority === 'medium');

    // Stage 2: Generate hypotheses from high/medium priority
    console.log('  💡 Generating hypotheses...');
    let hypothesesGenerated = 0;
    let validated = 0;
    let projectsCreated = 0;

    for (const scored of highPriority.slice(0, 5)) { // Limit to top 5 to avoid long runs
      const discovery = discoveries.find(d => d.id === scored.discovery_id);
      if (!discovery) continue;

      try {
        const hypotheses = await oracle.generateHypotheses(discovery);
        hypothesesGenerated += hypotheses.length;

        // Validate each hypothesis
        for (const hypothesis of hypotheses) {
          console.log(`  🔬 Validating: ${hypothesis.title}...`);
          const validation = await sage.validateHypothesis(hypothesis);
          if (validation) {
            validated++;

            // Create project if recommended
            if (validation.recommendation === 'pursue' || validation.recommendation === 'modify') {
              const project = await architect.designProject(hypothesis, validation);
              if (project) {
                projectsCreated++;
              }
            }
          }
        }

        // Mark as processed
        db.run('UPDATE discoveries SET processed = 1 WHERE id = ?', [discovery.id]);
      } catch (e) {
        console.error(`  Error processing ${discovery.id}:`, e.message);
      }
    }

    console.log(`\n✅ Pipeline complete: ${hypothesesGenerated} hypotheses, ${validated} validated, ${projectsCreated} projects`);

    res.json({
      success: true,
      hypothesesGenerated,
      validated,
      projectsCreated,
      processed: highPriority.length
    });
  } catch (e) {
    console.error('Pipeline error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== DOMAIN MANAGEMENT ==========

// Add new domain
app.post('/api/domains', async (req, res) => {
  try {
    const { id, name, keywords, emoji } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }

    const db = await getDatabase();
    db.run(`
      INSERT OR REPLACE INTO domains (id, name, keywords, mesh_terms, emoji, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `, [
      id.toLowerCase().replace(/\s+/g, '_'),
      name,
      JSON.stringify(keywords || []),
      JSON.stringify([]),
      emoji || '🔬'
    ]);

    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update domain
app.put('/api/domains/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, keywords, emoji, active } = req.body;
    const db = await getDatabase();

    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (keywords !== undefined) { updates.push('keywords = ?'); values.push(JSON.stringify(keywords)); }
    if (emoji !== undefined) { updates.push('emoji = ?'); values.push(emoji); }
    if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    db.run(`UPDATE domains SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete domain
app.delete('/api/domains/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();
    db.run('DELETE FROM domains WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update API key (stored in session, not persisted)
app.post('/api/settings/apikey', (req, res) => {
  const { apiKey } = req.body;
  const token = req.headers['x-session-token'];
  if (token && sessions.has(token)) {
    const session = sessions.get(token);
    session.apiKey = apiKey;
    // Set for current process
    process.env.ANTHROPIC_API_KEY = apiKey;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Check if API key is set
app.get('/api/settings/apikey/status', (req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  res.json({ configured: hasKey });
});

// ============================================
// RESEARCH PROJECT TRACKER API
// ============================================

// Project Groups
app.get('/api/tracker/groups', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getProjectGroups());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracker/groups', async (req, res) => {
  try {
    const db = await getDatabase();
    const id = db.createProjectGroup(req.body);
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tracker/groups/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.updateProjectGroup(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tracker/groups/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.deleteProjectGroup(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tracked Projects
app.get('/api/tracker/projects', async (req, res) => {
  try {
    const db = await getDatabase();
    const filters = {
      group_id: req.query.group_id,
      status: req.query.status,
      status_not: req.query.status_not || 'archived'
    };
    res.json(db.getTrackedProjects(filters));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tracker/projects/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    const project = db.getTrackedProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    project.milestones = db.getMilestones(req.params.id);
    project.activity = db.getProjectActivity(req.params.id, 20);
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracker/projects', async (req, res) => {
  try {
    const db = await getDatabase();
    const id = db.createTrackedProject(req.body);
    db.logProjectActivity(id, 'created', `Project "${req.body.title}" created`);
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tracker/projects/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.updateTrackedProject(req.params.id, req.body);
    db.logProjectActivity(req.params.id, 'updated', 'Project updated');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tracker/projects/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.deleteTrackedProject(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI Milestone Generation
app.post('/api/tracker/projects/generate-milestones', async (req, res) => {
  try {
    const { title, description, project_type, target_date } = req.body;
    
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    
    const prompt = `You are a research project planning assistant. Generate a list of milestones for the following research project.

Project Title: ${title}
Project Type: ${project_type || 'research project'}
Description: ${description}
Target Completion: ${target_date || 'Not specified'}

Generate 5-10 appropriate milestones for this type of project. Each milestone should have:
- title: Short, clear milestone name
- description: Brief description of what needs to be done
- estimated_days: Rough estimate of days needed

Return ONLY a JSON array of milestones, no other text. Example format:
[
  {"title": "Protocol Development", "description": "Draft study protocol and methods", "estimated_days": 14},
  {"title": "IRB Submission", "description": "Submit to institutional review board", "estimated_days": 7}
]`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = message.content[0].text;
    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse milestone response');
    }
    
    const milestones = JSON.parse(jsonMatch[0]);
    res.json({ milestones });
  } catch (e) {
    console.error('Milestone generation error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Milestones
app.get('/api/tracker/projects/:projectId/milestones', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getMilestones(req.params.projectId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracker/projects/:projectId/milestones', async (req, res) => {
  try {
    const db = await getDatabase();
    const milestone = { ...req.body, project_id: req.params.projectId };
    const id = db.createMilestone(milestone);
    db.logProjectActivity(req.params.projectId, 'milestone_added', `Milestone "${req.body.title}" added`, id);
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracker/projects/:projectId/milestones/bulk', async (req, res) => {
  try {
    const db = await getDatabase();
    const { milestones } = req.body;
    const ids = [];
    
    milestones.forEach((m, index) => {
      const id = db.createMilestone({
        ...m,
        project_id: req.params.projectId,
        sort_order: index
      });
      ids.push(id);
    });
    
    db.logProjectActivity(req.params.projectId, 'milestones_generated', `${milestones.length} milestones generated`);
    res.json({ ids, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tracker/milestones/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    const milestone = db.getMilestone(req.params.id);
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    
    db.updateMilestone(req.params.id, req.body);
    
    // Log status changes
    if (req.body.status && req.body.status !== milestone.status) {
      const action = req.body.status === 'completed' ? 'milestone_completed' : 'milestone_updated';
      db.logProjectActivity(milestone.project_id, action, `"${milestone.title}" status: ${req.body.status}`, req.params.id);
      
      // If completed, set completed_date
      if (req.body.status === 'completed' && !req.body.completed_date) {
        db.updateMilestone(req.params.id, { completed_date: new Date().toISOString().split('T')[0] });
      }
    }
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tracker/milestones/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.deleteMilestone(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tracker/projects/:projectId/milestones/reorder', async (req, res) => {
  try {
    const db = await getDatabase();
    db.reorderMilestones(req.params.projectId, req.body.orderedIds);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Assignees
app.post('/api/tracker/milestones/:milestoneId/assignees', async (req, res) => {
  try {
    const db = await getDatabase();
    const id = db.addMilestoneAssignee({ ...req.body, milestone_id: req.params.milestoneId });
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tracker/assignees/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.removeMilestoneAssignee(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dashboard Stats
app.get('/api/tracker/stats', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getProjectTrackerStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tracker/upcoming', async (req, res) => {
  try {
    const db = await getDatabase();
    const days = parseInt(req.query.days) || 14;
    res.json(db.getUpcomingDeadlines(days));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get pending WhatsApp reminders (for Clawdbot to send)
app.get('/api/tracker/reminders/pending-whatsapp', async (req, res) => {
  try {
    const db = await getDatabase();
    const reminders = db.getPendingWhatsAppReminders();
    res.json(reminders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get overdue milestones for auto-reminders
app.get('/api/tracker/reminders/overdue', async (req, res) => {
  try {
    const db = await getDatabase();
    const overdue = db.getOverdueMilestonesWithPhones();
    res.json(overdue);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark assignee as notified (called after WhatsApp sent)
app.post('/api/tracker/assignees/:assigneeId/notified', async (req, res) => {
  try {
    const db = await getDatabase();
    db.markAssigneeNotified(req.params.assigneeId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WhatsApp Business API - Send message
async function sendWhatsAppMessage(phone, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  
  if (!token || !phoneId) {
    throw new Error('WhatsApp Business API not configured');
  }

  // Clean phone number (remove spaces, dashes, ensure no leading +)
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'text',
      text: { body: message }
    })
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'WhatsApp API error');
  }
  
  return data;
}

// WhatsApp Reminder - Direct send via Business API
app.post('/api/tracker/milestones/:milestoneId/remind-whatsapp', async (req, res) => {
  try {
    const db = await getDatabase();
    const milestone = db.getMilestone(req.params.milestoneId);
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    
    const project = db.getTrackedProject(milestone.project_id);
    const assignees = milestone.assignees || [];
    const phones = assignees.filter(a => a.phone).map(a => ({ name: a.name, phone: a.phone, id: a.id }));
    
    if (phones.length === 0) {
      return res.status(400).json({ error: 'No assignees with phone numbers' });
    }

    // Build message
    const customMessage = req.body.message ? `\n\n💬 "${req.body.message}"` : '';
    const message = `🔔 *Reminder: ${milestone.title}*

📋 Project: ${project.title}
📅 Due: ${milestone.due_date || 'Not set'}
📍 Status: ${milestone.status}
${milestone.description ? `\n📝 ${milestone.description}` : ''}${customMessage}

--
Research Project Tracker`;

    const results = [];
    const errors = [];

    // Send to each assignee
    for (const assignee of phones) {
      try {
        await sendWhatsAppMessage(assignee.phone, message);
        results.push({ name: assignee.name, phone: assignee.phone, status: 'sent' });
        // Mark as notified
        db.markAssigneeNotified(assignee.id);
      } catch (e) {
        errors.push({ name: assignee.name, phone: assignee.phone, error: e.message });
      }
    }

    // Log activity
    if (results.length > 0) {
      db.logProjectActivity(
        milestone.project_id, 
        'whatsapp_sent', 
        `WhatsApp sent to: ${results.map(r => r.name).join(', ')}`,
        req.params.milestoneId
      );
    }

    res.json({
      success: results.length > 0,
      sent: results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e) {
    console.error('WhatsApp reminder error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Email Reminder (placeholder - needs Resend setup)
app.post('/api/tracker/milestones/:milestoneId/remind', async (req, res) => {
  try {
    const db = await getDatabase();
    const milestone = db.getMilestone(req.params.milestoneId);
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    
    const project = db.getTrackedProject(milestone.project_id);
    const assignees = milestone.assignees || [];
    const emails = assignees.filter(a => a.email).map(a => a.email);
    
    if (emails.length === 0) {
      return res.status(400).json({ error: 'No assignees with email addresses' });
    }

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      // Create reminder record but mark as pending (manual send needed)
      const reminderId = db.createReminder({
        milestone_id: req.params.milestoneId,
        recipient_emails: emails,
        subject: `🔔 Reminder: ${milestone.title} - ${project.title}`,
        message: req.body.message || `This is a reminder for milestone "${milestone.title}" in project "${project.title}".`,
        status: 'pending'
      });
      
      return res.json({
        success: true,
        reminder_id: reminderId,
        emails,
        note: 'RESEND_API_KEY not configured. Reminder saved but email not sent. Configure Resend to enable automatic emails.'
      });
    }

    // Send email via Resend
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailContent = `
Hi,

This is a reminder for the following milestone:

📋 Project: ${project.title}
📍 Milestone: ${milestone.title}
📅 Due Date: ${milestone.due_date || 'Not set'}
📝 Status: ${milestone.status}

${milestone.description ? `Description: ${milestone.description}` : ''}

${req.body.message ? `\nMessage from project lead:\n"${req.body.message}"` : ''}

--
Research Project Tracker
    `.trim();

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Research Tracker <notifications@resend.dev>',
      to: emails,
      subject: `🔔 Reminder: ${milestone.title} - ${project.title}`,
      text: emailContent
    });

    if (error) {
      const reminderId = db.createReminder({
        milestone_id: req.params.milestoneId,
        recipient_emails: emails,
        subject: `🔔 Reminder: ${milestone.title}`,
        message: emailContent,
        status: 'failed'
      });
      db.updateReminderStatus(reminderId, 'failed', error.message);
      return res.status(500).json({ error: error.message });
    }

    const reminderId = db.createReminder({
      milestone_id: req.params.milestoneId,
      recipient_emails: emails,
      subject: `🔔 Reminder: ${milestone.title}`,
      message: emailContent,
      status: 'sent'
    });
    db.updateReminderStatus(reminderId, 'sent');
    db.logProjectActivity(milestone.project_id, 'reminder_sent', `Reminder sent to ${emails.join(', ')}`, req.params.milestoneId);

    res.json({ success: true, reminder_id: reminderId, emails, email_id: data?.id });
  } catch (e) {
    console.error('Reminder error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// SCHEDULED REMINDERS
// ============================================

// Get scheduled reminders for a project
app.get('/api/tracker/projects/:projectId/reminders', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.getScheduledReminders(req.params.projectId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a scheduled reminder
app.post('/api/tracker/projects/:projectId/reminders', async (req, res) => {
  try {
    const db = await getDatabase();
    const id = db.createScheduledReminder({
      ...req.body,
      project_id: req.params.projectId
    });
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a scheduled reminder
app.delete('/api/tracker/reminders/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    db.deleteScheduledReminder(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check and send due reminders (call this from cron or periodically)
app.post('/api/tracker/reminders/process', async (req, res) => {
  try {
    const db = await getDatabase();
    const dueReminders = db.getDueScheduledReminders();
    
    const results = [];
    
    for (const reminder of dueReminders) {
      // Get assignees with phones for this project/milestone
      let assignees = [];
      if (reminder.milestone_id) {
        assignees = db.getMilestoneAssignees(reminder.milestone_id).filter(a => a.phone);
      } else if (reminder.project_id) {
        // Get all assignees from all milestones in the project
        const milestones = db.getMilestones(reminder.project_id);
        for (const m of milestones) {
          assignees.push(...(m.assignees || []).filter(a => a.phone));
        }
      }

      if (assignees.length === 0) continue;

      // Build message
      const message = `📅 *Scheduled Reminder*\n\n` +
        `📋 Project: ${reminder.project_title || 'Unknown'}\n` +
        (reminder.milestone_title ? `📍 Milestone: ${reminder.milestone_title}\n` : '') +
        (reminder.due_date ? `⏰ Due: ${reminder.due_date}\n` : '') +
        `\n--\nResearch Project Tracker`;

      // Send to all assignees
      for (const assignee of assignees) {
        try {
          await sendWhatsAppMessage(assignee.phone, message);
          results.push({ reminder_id: reminder.id, assignee: assignee.name, status: 'sent' });
        } catch (e) {
          results.push({ reminder_id: reminder.id, assignee: assignee.name, status: 'failed', error: e.message });
        }
      }

      // Mark reminder as sent
      db.updateScheduledReminderSent(reminder.id);
    }

    res.json({ processed: dueReminders.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// WHATSAPP WEBHOOK (for incoming messages)
// ============================================

// Webhook verification (GET request from Meta)
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Verify token should be set in environment
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'research_tracker_webhook';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Incoming messages (POST from Meta)
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      const db = await getDatabase();

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            const messages = change.value?.messages || [];
            
            for (const msg of messages) {
              if (msg.type === 'text') {
                const result = db.saveIncomingWhatsApp({
                  from_phone: msg.from,
                  from_name: change.value?.contacts?.[0]?.profile?.name,
                  message: msg.text?.body || '',
                  wa_message_id: msg.id
                });

                console.log(`WhatsApp received from ${msg.from}: "${msg.text?.body?.substring(0, 50)}..." → Project: ${result.matched_project || 'none'}`);
              }
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});

// Get incoming WhatsApp messages
app.get('/api/tracker/whatsapp/messages', async (req, res) => {
  try {
    const db = await getDatabase();
    const projectId = req.query.project_id;
    
    if (projectId) {
      res.json(db.getProjectWhatsAppMessages(projectId));
    } else {
      res.json(db.getRecentWhatsAppMessages());
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server - bind to 0.0.0.0 for Railway/cloud deployment
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔬 Research Agents Dashboard`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Password: ${DASHBOARD_PASSWORD}\n`);
});
