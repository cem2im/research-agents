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

// Start server - bind to 0.0.0.0 for Railway/cloud deployment
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔬 Research Agents Dashboard`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Password: ${DASHBOARD_PASSWORD}\n`);
});
