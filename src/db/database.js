import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));

class ResearchDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    const SQL = await initSqlJs();

    // Ensure directory exists
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Load existing database or create new one
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    // Run schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    this.db.run(schema);
    this.save();

    this.initialized = true;
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  // Helper to run queries
  run(sql, params = []) {
    this.db.run(sql, params);
    this.save();
  }

  // Helper to get all results
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // Helper to get single result
  get(sql, params = []) {
    const results = this.all(sql, params);
    return results[0] || null;
  }

  // Helper to convert undefined to null for SQL
  nullify(value) {
    return value === undefined ? null : value;
  }

  // Discoveries
  insertDiscovery(discovery) {
    // Check if discovery already exists by external_id and source
    if (discovery.external_id && discovery.source) {
      const existing = this.get(
        'SELECT id FROM discoveries WHERE external_id = ? AND source = ?',
        [discovery.external_id, discovery.source]
      );
      if (existing) {
        return existing.id; // Skip duplicate
      }
    }

    // Also check by normalized title to catch duplicates across sources
    if (discovery.title) {
      const normalizedTitle = discovery.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 100);
      const existingByTitle = this.get(
        `SELECT id FROM discoveries WHERE REPLACE(REPLACE(LOWER(title), ' ', ''), '.', '') LIKE ?`,
        [`%${normalizedTitle.substring(0, 50)}%`]
      );
      if (existingByTitle) {
        return existingByTitle.id; // Skip duplicate
      }
    }

    const id = discovery.id || uuidv4();
    this.run(`
      INSERT OR REPLACE INTO discoveries
      (id, source, external_id, title, abstract, authors, publication_date,
       journal, url, citation_count, influence_score, mesh_terms, keywords,
       relevance_score, priority, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      this.nullify(discovery.source),
      this.nullify(discovery.external_id),
      this.nullify(discovery.title),
      this.nullify(discovery.abstract),
      JSON.stringify(discovery.authors || []),
      this.nullify(discovery.publication_date),
      this.nullify(discovery.journal),
      this.nullify(discovery.url),
      discovery.citation_count || 0,
      this.nullify(discovery.influence_score),
      JSON.stringify(discovery.mesh_terms || []),
      JSON.stringify(discovery.keywords || []),
      this.nullify(discovery.relevance_score),
      this.nullify(discovery.priority),
      JSON.stringify(discovery.metadata || {})
    ]);

    return id;
  }

  getUnprocessedDiscoveries(limit = 10) {
    const results = this.all(`
      SELECT * FROM discoveries
      WHERE processed = 0
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT ?
    `, [limit]);
    return results.map(this.parseDiscovery);
  }

  getDiscoveriesByPriority(priority, limit = 20) {
    const results = this.all(`
      SELECT * FROM discoveries
      WHERE priority = ?
      ORDER BY relevance_score DESC
      LIMIT ?
    `, [priority, limit]);
    return results.map(this.parseDiscovery);
  }

  markDiscoveryProcessed(id) {
    this.run('UPDATE discoveries SET processed = 1 WHERE id = ?', [id]);
  }

  parseDiscovery(row) {
    return {
      ...row,
      authors: JSON.parse(row.authors || '[]'),
      mesh_terms: JSON.parse(row.mesh_terms || '[]'),
      keywords: JSON.parse(row.keywords || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      processed: Boolean(row.processed)
    };
  }

  // Hypotheses
  insertHypothesis(hypothesis) {
    const id = hypothesis.id || uuidv4();
    this.run(`
      INSERT INTO hypotheses
      (id, discovery_id, title, statement, rationale, assumptions,
       testable_predictions, required_evidence, potential_impact, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      hypothesis.discovery_id,
      hypothesis.title,
      hypothesis.statement,
      hypothesis.rationale,
      JSON.stringify(hypothesis.assumptions || []),
      JSON.stringify(hypothesis.testable_predictions || []),
      JSON.stringify(hypothesis.required_evidence || []),
      hypothesis.potential_impact,
      hypothesis.confidence_score
    ]);

    return id;
  }

  getHypothesesByStatus(status, limit = 10) {
    const results = this.all(`
      SELECT h.*, d.title as discovery_title
      FROM hypotheses h
      LEFT JOIN discoveries d ON h.discovery_id = d.id
      WHERE h.status = ?
      ORDER BY h.confidence_score DESC
      LIMIT ?
    `, [status, limit]);
    return results.map(this.parseHypothesis);
  }

  updateHypothesisStatus(id, status) {
    this.run('UPDATE hypotheses SET status = ? WHERE id = ?', [status, id]);
  }

  // Update hypothesis content (for editing before validation)
  updateHypothesis(id, updates) {
    const fields = [];
    const values = [];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.statement !== undefined) { fields.push('statement = ?'); values.push(updates.statement); }
    if (updates.rationale !== undefined) { fields.push('rationale = ?'); values.push(updates.rationale); }
    if (updates.assumptions !== undefined) { fields.push('assumptions = ?'); values.push(JSON.stringify(updates.assumptions)); }
    if (updates.testable_predictions !== undefined) { fields.push('testable_predictions = ?'); values.push(JSON.stringify(updates.testable_predictions)); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

    if (fields.length === 0) return;

    values.push(id);
    this.run(`UPDATE hypotheses SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  // Get single hypothesis by ID
  getHypothesis(id) {
    const result = this.get('SELECT * FROM hypotheses WHERE id = ?', [id]);
    return result ? this.parseHypothesis(result) : null;
  }

  parseHypothesis(row) {
    return {
      ...row,
      assumptions: JSON.parse(row.assumptions || '[]'),
      testable_predictions: JSON.parse(row.testable_predictions || '[]'),
      required_evidence: JSON.parse(row.required_evidence || '[]')
    };
  }

  // Validations
  insertValidation(validation) {
    const id = validation.id || uuidv4();
    this.run(`
      INSERT INTO validations
      (id, hypothesis_id, supporting_evidence, contradicting_evidence,
       gaps_identified, key_papers, confidence_level, recommendation, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      validation.hypothesis_id,
      JSON.stringify(validation.supporting_evidence || []),
      JSON.stringify(validation.contradicting_evidence || []),
      JSON.stringify(validation.gaps_identified || []),
      JSON.stringify(validation.key_papers || []),
      validation.confidence_level,
      validation.recommendation,
      validation.summary
    ]);

    return id;
  }

  getValidationByHypothesis(hypothesisId) {
    const result = this.get(`
      SELECT * FROM validations WHERE hypothesis_id = ?
    `, [hypothesisId]);
    return result ? this.parseValidation(result) : null;
  }

  parseValidation(row) {
    return {
      ...row,
      supporting_evidence: JSON.parse(row.supporting_evidence || '[]'),
      contradicting_evidence: JSON.parse(row.contradicting_evidence || '[]'),
      gaps_identified: JSON.parse(row.gaps_identified || '[]'),
      key_papers: JSON.parse(row.key_papers || '[]')
    };
  }

  // Projects
  insertProject(project) {
    const id = project.id || uuidv4();
    this.run(`
      INSERT INTO projects
      (id, hypothesis_id, title, objective, methodology, milestones,
       resources_required, timeline_weeks, estimated_cost_usd, output_type,
       feasibility_score, risk_assessment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      project.hypothesis_id,
      project.title,
      project.objective,
      project.methodology,
      JSON.stringify(project.milestones || []),
      JSON.stringify(project.resources_required || []),
      project.timeline_weeks,
      project.estimated_cost_usd,
      project.output_type,
      project.feasibility_score,
      project.risk_assessment
    ]);

    return id;
  }

  getProjectsByStatus(status, limit = 10) {
    const results = this.all(`
      SELECT p.*, h.title as hypothesis_title
      FROM projects p
      LEFT JOIN hypotheses h ON p.hypothesis_id = h.id
      WHERE p.status = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `, [status, limit]);
    return results.map(this.parseProject);
  }

  updateProjectStatus(id, status) {
    this.run('UPDATE projects SET status = ? WHERE id = ?', [status, id]);
  }

  parseProject(row) {
    return {
      ...row,
      milestones: JSON.parse(row.milestones || '[]'),
      resources_required: JSON.parse(row.resources_required || '[]')
    };
  }

  // Reviews
  insertReview(review) {
    const id = review.id || uuidv4();
    this.run(`
      INSERT INTO reviews
      (id, project_id, critical_questions, weaknesses, risks,
       competitor_threats, regulatory_concerns, recommended_mitigations, overall_assessment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      review.project_id,
      JSON.stringify(review.critical_questions || []),
      JSON.stringify(review.weaknesses || []),
      JSON.stringify(review.risks || []),
      review.competitor_threats,
      review.regulatory_concerns,
      JSON.stringify(review.recommended_mitigations || []),
      review.overall_assessment
    ]);

    return id;
  }

  getReviewByProject(projectId) {
    const result = this.get(`
      SELECT * FROM reviews WHERE project_id = ?
    `, [projectId]);
    return result ? this.parseReview(result) : null;
  }

  parseReview(row) {
    return {
      ...row,
      critical_questions: JSON.parse(row.critical_questions || '[]'),
      weaknesses: JSON.parse(row.weaknesses || '[]'),
      risks: JSON.parse(row.risks || '[]'),
      recommended_mitigations: JSON.parse(row.recommended_mitigations || '[]')
    };
  }

  // Activity logging
  logActivity(agent, action, entityType, entityId, summary) {
    this.run(`
      INSERT INTO activity_log (agent, action, entity_type, entity_id, summary)
      VALUES (?, ?, ?, ?, ?)
    `, [agent, action, entityType, entityId, summary]);
  }

  getRecentActivity(limit = 50) {
    return this.all(`
      SELECT * FROM activity_log
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);
  }

  // Domains
  getActiveDomains() {
    const results = this.all('SELECT * FROM domains WHERE active = 1');
    return results.map(d => ({
      ...d,
      keywords: JSON.parse(d.keywords || '[]'),
      mesh_terms: JSON.parse(d.mesh_terms || '[]'),
      active: Boolean(d.active)
    }));
  }

  // Stats
  getStats() {
    return {
      discoveries: this.get('SELECT COUNT(*) as count FROM discoveries')?.count || 0,
      unprocessed: this.get('SELECT COUNT(*) as count FROM discoveries WHERE processed = 0')?.count || 0,
      hypotheses: this.get('SELECT COUNT(*) as count FROM hypotheses')?.count || 0,
      validations: this.get('SELECT COUNT(*) as count FROM validations')?.count || 0,
      projects: this.get('SELECT COUNT(*) as count FROM projects')?.count || 0,
      reviews: this.get('SELECT COUNT(*) as count FROM reviews')?.count || 0,
      feedback: this.get('SELECT COUNT(*) as count FROM feedback')?.count || 0,
      memory: this.get('SELECT COUNT(*) as count FROM memory WHERE active = 1')?.count || 0
    };
  }

  // ========== FEEDBACK SYSTEM ==========

  // Add or update feedback on any entity
  addFeedback(entityType, entityId, feedback) {
    const id = feedback.id || uuidv4();
    const existing = this.get(
      'SELECT id FROM feedback WHERE entity_type = ? AND entity_id = ?',
      [entityType, entityId]
    );

    if (existing) {
      this.run(`
        UPDATE feedback SET
          rating = ?, useful = ?, notes = ?, tags = ?, action_taken = ?, updated_at = ?
        WHERE entity_type = ? AND entity_id = ?
      `, [
        this.nullify(feedback.rating),
        feedback.useful ? 1 : 0,
        this.nullify(feedback.notes),
        JSON.stringify(feedback.tags || []),
        this.nullify(feedback.action_taken),
        new Date().toISOString(),
        entityType,
        entityId
      ]);
      return existing.id;
    }

    this.run(`
      INSERT INTO feedback (id, entity_type, entity_id, rating, useful, notes, tags, action_taken)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, entityType, entityId,
      this.nullify(feedback.rating),
      feedback.useful ? 1 : 0,
      this.nullify(feedback.notes),
      JSON.stringify(feedback.tags || []),
      this.nullify(feedback.action_taken)
    ]);

    return id;
  }

  getFeedback(entityType, entityId) {
    const result = this.get(
      'SELECT * FROM feedback WHERE entity_type = ? AND entity_id = ?',
      [entityType, entityId]
    );
    if (!result) return null;
    return {
      ...result,
      tags: JSON.parse(result.tags || '[]'),
      useful: Boolean(result.useful)
    };
  }

  getAllFeedback(entityType = null, limit = 50) {
    const sql = entityType
      ? 'SELECT * FROM feedback WHERE entity_type = ? ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT * FROM feedback ORDER BY updated_at DESC LIMIT ?';
    const params = entityType ? [entityType, limit] : [limit];

    return this.all(sql, params).map(r => ({
      ...r,
      tags: JSON.parse(r.tags || '[]'),
      useful: Boolean(r.useful)
    }));
  }

  getUsefulEntities(entityType, limit = 20) {
    return this.all(`
      SELECT f.*,
        CASE
          WHEN f.entity_type = 'hypothesis' THEN h.title
          WHEN f.entity_type = 'discovery' THEN d.title
          WHEN f.entity_type = 'project' THEN p.title
        END as entity_title
      FROM feedback f
      LEFT JOIN hypotheses h ON f.entity_type = 'hypothesis' AND f.entity_id = h.id
      LEFT JOIN discoveries d ON f.entity_type = 'discovery' AND f.entity_id = d.id
      LEFT JOIN projects p ON f.entity_type = 'project' AND f.entity_id = p.id
      WHERE f.entity_type = ? AND f.useful = 1
      ORDER BY f.rating DESC, f.updated_at DESC
      LIMIT ?
    `, [entityType, limit]);
  }

  // ========== MEMORY SYSTEM ==========

  // Add a memory entry (user's own insights)
  addMemory(memory) {
    const id = memory.id || uuidv4();
    this.run(`
      INSERT INTO memory (id, category, title, content, keywords, related_entities, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      memory.category,
      memory.title,
      memory.content,
      JSON.stringify(memory.keywords || []),
      JSON.stringify(memory.related_entities || []),
      memory.importance || 'normal'
    ]);
    return id;
  }

  updateMemory(id, updates) {
    const fields = [];
    const values = [];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.keywords !== undefined) { fields.push('keywords = ?'); values.push(JSON.stringify(updates.keywords)); }
    if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(updates.importance); }
    if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.run(`UPDATE memory SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  getMemory(id) {
    const result = this.get('SELECT * FROM memory WHERE id = ?', [id]);
    return result ? this.parseMemory(result) : null;
  }

  getMemoryByCategory(category, activeOnly = true) {
    const sql = activeOnly
      ? 'SELECT * FROM memory WHERE category = ? AND active = 1 ORDER BY importance DESC, created_at DESC'
      : 'SELECT * FROM memory WHERE category = ? ORDER BY importance DESC, created_at DESC';
    return this.all(sql, [category]).map(this.parseMemory);
  }

  getAllMemory(activeOnly = true) {
    const sql = activeOnly
      ? 'SELECT * FROM memory WHERE active = 1 ORDER BY importance DESC, created_at DESC'
      : 'SELECT * FROM memory ORDER BY importance DESC, created_at DESC';
    return this.all(sql).map(this.parseMemory);
  }

  searchMemory(query) {
    // Simple keyword search in title and content
    const pattern = `%${query}%`;
    return this.all(`
      SELECT * FROM memory
      WHERE active = 1 AND (title LIKE ? OR content LIKE ? OR keywords LIKE ?)
      ORDER BY importance DESC
    `, [pattern, pattern, pattern]).map(this.parseMemory);
  }

  parseMemory(row) {
    return {
      ...row,
      keywords: JSON.parse(row.keywords || '[]'),
      related_entities: JSON.parse(row.related_entities || '[]'),
      active: Boolean(row.active)
    };
  }

  // ========== LEARNING PREFERENCES ==========

  addPreference(pref) {
    const id = pref.id || uuidv4();
    const existing = this.get(
      'SELECT id, weight FROM preferences WHERE preference_type = ? AND value = ?',
      [pref.preference_type, pref.value]
    );

    if (existing) {
      // Increase weight if already exists
      const newWeight = (existing.weight || 1) + (pref.weight || 0.1);
      this.run('UPDATE preferences SET weight = ?, updated_at = ? WHERE id = ?',
        [newWeight, new Date().toISOString(), existing.id]);
      return existing.id;
    }

    this.run(`
      INSERT INTO preferences (id, preference_type, value, weight, learned_from)
      VALUES (?, ?, ?, ?, ?)
    `, [
      id,
      pref.preference_type,
      pref.value,
      pref.weight || 1.0,
      JSON.stringify(pref.learned_from || [])
    ]);
    return id;
  }

  getPreferences(type = null) {
    const sql = type
      ? 'SELECT * FROM preferences WHERE preference_type = ? ORDER BY weight DESC'
      : 'SELECT * FROM preferences ORDER BY weight DESC';
    const params = type ? [type] : [];
    return this.all(sql, params).map(p => ({
      ...p,
      learned_from: JSON.parse(p.learned_from || '[]')
    }));
  }

  // ========== FULL TEXT CACHE ==========

  cacheFullText(discoveryId, pmcid, fullText, sections) {
    const id = discoveryId;
    this.run(`
      INSERT OR REPLACE INTO full_texts (id, discovery_id, pmcid, full_text, sections)
      VALUES (?, ?, ?, ?, ?)
    `, [id, discoveryId, pmcid, fullText, JSON.stringify(sections || [])]);
  }

  getFullText(discoveryId) {
    const result = this.get('SELECT * FROM full_texts WHERE discovery_id = ?', [discoveryId]);
    if (!result) return null;
    return {
      ...result,
      sections: JSON.parse(result.sections || '[]')
    };
  }

  // Get domain by ID
  getDomain(domainId) {
    const result = this.get('SELECT * FROM domains WHERE id = ?', [domainId]);
    if (!result) return null;
    return {
      ...result,
      keywords: JSON.parse(result.keywords || '[]'),
      mesh_terms: JSON.parse(result.mesh_terms || '[]'),
      active: Boolean(result.active)
    };
  }

  close() {
    if (this.db) {
      this.save();
      this.db.close();
    }
  }

  // ============================================
  // RESEARCH PROJECT TRACKER
  // ============================================

  // Project Groups
  createProjectGroup(group) {
    const id = group.id || uuidv4();
    this.run(`
      INSERT INTO project_groups (id, name, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `, [id, group.name, group.color || '#3b82f6', group.icon || '📁', group.sort_order || 0]);
    return id;
  }

  getProjectGroups() {
    return this.all('SELECT * FROM project_groups ORDER BY sort_order, name');
  }

  updateProjectGroup(id, updates) {
    const fields = [];
    const values = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
    if (updates.icon !== undefined) { fields.push('icon = ?'); values.push(updates.icon); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
    if (fields.length === 0) return;
    values.push(id);
    this.run(`UPDATE project_groups SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  deleteProjectGroup(id) {
    this.run('DELETE FROM project_groups WHERE id = ?', [id]);
  }

  // Tracked Projects
  createTrackedProject(project) {
    const id = project.id || uuidv4();
    this.run(`
      INSERT INTO tracked_projects (id, group_id, title, description, project_type, status, priority, start_date, target_date, tags, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      this.nullify(project.group_id),
      project.title,
      this.nullify(project.description),
      project.project_type || 'other',
      project.status || 'active',
      project.priority || 'medium',
      this.nullify(project.start_date),
      this.nullify(project.target_date),
      JSON.stringify(project.tags || []),
      this.nullify(project.notes)
    ]);
    return id;
  }

  getTrackedProjects(filters = {}) {
    let sql = `
      SELECT tp.*, pg.name as group_name, pg.color as group_color, pg.icon as group_icon,
        (SELECT COUNT(*) FROM tracked_milestones WHERE project_id = tp.id) as total_milestones,
        (SELECT COUNT(*) FROM tracked_milestones WHERE project_id = tp.id AND status = 'completed') as completed_milestones
      FROM tracked_projects tp
      LEFT JOIN project_groups pg ON tp.group_id = pg.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.group_id) {
      sql += ' AND tp.group_id = ?';
      params.push(filters.group_id);
    }
    if (filters.status) {
      sql += ' AND tp.status = ?';
      params.push(filters.status);
    }
    if (filters.status_not) {
      sql += ' AND tp.status != ?';
      params.push(filters.status_not);
    }

    sql += ' ORDER BY pg.sort_order, tp.priority DESC, tp.created_at DESC';

    return this.all(sql, params).map(p => ({
      ...p,
      tags: JSON.parse(p.tags || '[]')
    }));
  }

  getTrackedProject(id) {
    const project = this.get(`
      SELECT tp.*, pg.name as group_name, pg.color as group_color, pg.icon as group_icon
      FROM tracked_projects tp
      LEFT JOIN project_groups pg ON tp.group_id = pg.id
      WHERE tp.id = ?
    `, [id]);
    if (!project) return null;
    return {
      ...project,
      tags: JSON.parse(project.tags || '[]')
    };
  }

  updateTrackedProject(id, updates) {
    const fields = [];
    const values = [];
    if (updates.group_id !== undefined) { fields.push('group_id = ?'); values.push(updates.group_id); }
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.project_type !== undefined) { fields.push('project_type = ?'); values.push(updates.project_type); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.current_milestone_id !== undefined) { fields.push('current_milestone_id = ?'); values.push(updates.current_milestone_id); }
    if (updates.start_date !== undefined) { fields.push('start_date = ?'); values.push(updates.start_date); }
    if (updates.target_date !== undefined) { fields.push('target_date = ?'); values.push(updates.target_date); }
    if (updates.completed_date !== undefined) { fields.push('completed_date = ?'); values.push(updates.completed_date); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    
    this.run(`UPDATE tracked_projects SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  deleteTrackedProject(id) {
    this.run('DELETE FROM tracked_projects WHERE id = ?', [id]);
  }

  // Milestones
  createMilestone(milestone) {
    const id = milestone.id || uuidv4();
    this.run(`
      INSERT INTO tracked_milestones (id, project_id, sort_order, title, description, status, start_date, due_date, estimated_days, dependencies, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      milestone.project_id,
      milestone.sort_order || 0,
      milestone.title,
      this.nullify(milestone.description),
      milestone.status || 'pending',
      this.nullify(milestone.start_date),
      this.nullify(milestone.due_date),
      this.nullify(milestone.estimated_days),
      JSON.stringify(milestone.dependencies || []),
      this.nullify(milestone.notes)
    ]);
    return id;
  }

  getMilestones(projectId) {
    const milestones = this.all(`
      SELECT * FROM tracked_milestones WHERE project_id = ? ORDER BY sort_order
    `, [projectId]);

    return milestones.map(m => ({
      ...m,
      dependencies: JSON.parse(m.dependencies || '[]'),
      blockers: JSON.parse(m.blockers || '[]'),
      assignees: this.getMilestoneAssignees(m.id)
    }));
  }

  getMilestone(id) {
    const milestone = this.get('SELECT * FROM tracked_milestones WHERE id = ?', [id]);
    if (!milestone) return null;
    return {
      ...milestone,
      dependencies: JSON.parse(milestone.dependencies || '[]'),
      blockers: JSON.parse(milestone.blockers || '[]'),
      assignees: this.getMilestoneAssignees(id)
    };
  }

  updateMilestone(id, updates) {
    const fields = [];
    const values = [];
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.start_date !== undefined) { fields.push('start_date = ?'); values.push(updates.start_date); }
    if (updates.due_date !== undefined) { fields.push('due_date = ?'); values.push(updates.due_date); }
    if (updates.completed_date !== undefined) { fields.push('completed_date = ?'); values.push(updates.completed_date); }
    if (updates.estimated_days !== undefined) { fields.push('estimated_days = ?'); values.push(updates.estimated_days); }
    if (updates.actual_days !== undefined) { fields.push('actual_days = ?'); values.push(updates.actual_days); }
    if (updates.dependencies !== undefined) { fields.push('dependencies = ?'); values.push(JSON.stringify(updates.dependencies)); }
    if (updates.blockers !== undefined) { fields.push('blockers = ?'); values.push(JSON.stringify(updates.blockers)); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    
    this.run(`UPDATE tracked_milestones SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  deleteMilestone(id) {
    this.run('DELETE FROM tracked_milestones WHERE id = ?', [id]);
  }

  reorderMilestones(projectId, orderedIds) {
    orderedIds.forEach((id, index) => {
      this.run('UPDATE tracked_milestones SET sort_order = ? WHERE id = ? AND project_id = ?', [index, id, projectId]);
    });
  }

  // Milestone Assignees
  addMilestoneAssignee(assignee) {
    const id = assignee.id || uuidv4();
    this.run(`
      INSERT INTO milestone_assignees (id, milestone_id, name, email, phone, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, assignee.milestone_id, assignee.name, this.nullify(assignee.email), this.nullify(assignee.phone), assignee.role || 'assignee']);
    return id;
  }

  getMilestoneAssignees(milestoneId) {
    return this.all('SELECT * FROM milestone_assignees WHERE milestone_id = ?', [milestoneId]);
  }

  removeMilestoneAssignee(id) {
    this.run('DELETE FROM milestone_assignees WHERE id = ?', [id]);
  }

  // Reminders
  createReminder(reminder) {
    const id = reminder.id || uuidv4();
    this.run(`
      INSERT INTO project_reminders (id, milestone_id, recipient_emails, subject, message, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      reminder.milestone_id,
      JSON.stringify(reminder.recipient_emails || []),
      reminder.subject,
      reminder.message,
      this.nullify(reminder.scheduled_at),
      reminder.status || 'pending'
    ]);
    return id;
  }

  updateReminderStatus(id, status, error = null) {
    this.run(`
      UPDATE project_reminders SET status = ?, sent_at = ?, error = ? WHERE id = ?
    `, [status, status === 'sent' ? new Date().toISOString() : null, error, id]);
  }

  // Project Activity
  logProjectActivity(projectId, action, details, milestoneId = null) {
    this.run(`
      INSERT INTO project_activity (project_id, milestone_id, action, details)
      VALUES (?, ?, ?, ?)
    `, [projectId, milestoneId, action, details]);
  }

  getProjectActivity(projectId, limit = 50) {
    return this.all(`
      SELECT pa.*, tm.title as milestone_title
      FROM project_activity pa
      LEFT JOIN tracked_milestones tm ON pa.milestone_id = tm.id
      WHERE pa.project_id = ?
      ORDER BY pa.created_at DESC
      LIMIT ?
    `, [projectId, limit]);
  }

  // Dashboard stats
  getProjectTrackerStats() {
    return {
      total_projects: this.get('SELECT COUNT(*) as count FROM tracked_projects')?.count || 0,
      active_projects: this.get("SELECT COUNT(*) as count FROM tracked_projects WHERE status = 'active'")?.count || 0,
      completed_projects: this.get("SELECT COUNT(*) as count FROM tracked_projects WHERE status = 'completed'")?.count || 0,
      overdue_milestones: this.get(`
        SELECT COUNT(*) as count FROM tracked_milestones 
        WHERE status IN ('pending', 'in_progress') AND due_date < date('now')
      `)?.count || 0,
      upcoming_milestones: this.get(`
        SELECT COUNT(*) as count FROM tracked_milestones 
        WHERE status IN ('pending', 'in_progress') 
        AND due_date >= date('now') AND due_date <= date('now', '+7 days')
      `)?.count || 0
    };
  }

  getUpcomingDeadlines(days = 14) {
    return this.all(`
      SELECT tm.*, tp.title as project_title, tp.priority as project_priority,
        pg.name as group_name, pg.color as group_color
      FROM tracked_milestones tm
      JOIN tracked_projects tp ON tm.project_id = tp.id
      LEFT JOIN project_groups pg ON tp.group_id = pg.id
      WHERE tm.status IN ('pending', 'in_progress')
        AND tm.due_date IS NOT NULL
        AND tm.due_date <= date('now', '+' || ? || ' days')
      ORDER BY tm.due_date ASC
    `, [days]).map(m => ({
      ...m,
      assignees: this.getMilestoneAssignees(m.id)
    }));
  }

  // Get pending WhatsApp reminders (not sent yet, with phone numbers)
  getPendingWhatsAppReminders() {
    return this.all(`
      SELECT pr.*, tm.title as milestone_title, tm.due_date, tm.status as milestone_status,
        tp.title as project_title, tp.priority as project_priority,
        ma.name as assignee_name, ma.phone as assignee_phone
      FROM project_reminders pr
      JOIN tracked_milestones tm ON pr.milestone_id = tm.id
      JOIN tracked_projects tp ON tm.project_id = tp.id
      JOIN milestone_assignees ma ON tm.id = ma.milestone_id
      WHERE pr.status = 'pending'
        AND ma.phone IS NOT NULL
        AND ma.phone != ''
      ORDER BY pr.created_at ASC
    `);
  }

  // Get overdue milestones with phone contacts for auto-reminders
  getOverdueMilestonesWithPhones() {
    return this.all(`
      SELECT tm.*, tp.title as project_title, tp.priority as project_priority,
        ma.name as assignee_name, ma.phone as assignee_phone, ma.id as assignee_id
      FROM tracked_milestones tm
      JOIN tracked_projects tp ON tm.project_id = tp.id
      JOIN milestone_assignees ma ON tm.id = ma.milestone_id
      WHERE tm.status IN ('pending', 'in_progress')
        AND tm.due_date IS NOT NULL
        AND tm.due_date <= date('now')
        AND ma.phone IS NOT NULL
        AND ma.phone != ''
        AND (ma.notified_at IS NULL OR ma.notified_at < date('now', '-1 day'))
      ORDER BY tm.due_date ASC
    `);
  }

  // Mark assignee as notified
  markAssigneeNotified(assigneeId) {
    this.run('UPDATE milestone_assignees SET notified_at = ? WHERE id = ?', 
      [new Date().toISOString(), assigneeId]);
  }

  // ========== SCHEDULED REMINDERS ==========
  
  createScheduledReminder(reminder) {
    const id = reminder.id || uuidv4();
    this.run(`
      INSERT INTO scheduled_reminders (id, project_id, milestone_id, schedule_type, schedule_day, schedule_time, days_before_due, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      this.nullify(reminder.project_id),
      this.nullify(reminder.milestone_id),
      reminder.schedule_type,
      this.nullify(reminder.schedule_day),
      reminder.schedule_time || '09:00',
      this.nullify(reminder.days_before_due),
      reminder.active !== false ? 1 : 0
    ]);
    return id;
  }

  getScheduledReminders(projectId = null) {
    const sql = projectId 
      ? 'SELECT * FROM scheduled_reminders WHERE project_id = ? AND active = 1'
      : 'SELECT * FROM scheduled_reminders WHERE active = 1';
    return this.all(sql, projectId ? [projectId] : []);
  }

  getDueScheduledReminders() {
    const now = new Date();
    const today = now.getDay(); // 0 = Sunday
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const todayDate = now.toISOString().split('T')[0];

    return this.all(`
      SELECT sr.*, tp.title as project_title, tm.title as milestone_title, tm.due_date
      FROM scheduled_reminders sr
      LEFT JOIN tracked_projects tp ON sr.project_id = tp.id
      LEFT JOIN tracked_milestones tm ON sr.milestone_id = tm.id
      WHERE sr.active = 1
        AND (
          (sr.schedule_type = 'weekly' AND sr.schedule_day = ? AND sr.schedule_time <= ?)
          OR (sr.schedule_type = 'daily' AND sr.schedule_time <= ?)
          OR (sr.schedule_type = 'before_due' AND tm.due_date IS NOT NULL 
              AND date(tm.due_date, '-' || sr.days_before_due || ' days') = ?)
        )
        AND (sr.last_sent_at IS NULL OR date(sr.last_sent_at) < ?)
    `, [today, currentTime, currentTime, todayDate, todayDate]);
  }

  updateScheduledReminderSent(id) {
    this.run('UPDATE scheduled_reminders SET last_sent_at = ? WHERE id = ?', 
      [new Date().toISOString(), id]);
  }

  deleteScheduledReminder(id) {
    this.run('DELETE FROM scheduled_reminders WHERE id = ?', [id]);
  }

  // ========== WHATSAPP INCOMING MESSAGES ==========
  
  saveIncomingWhatsApp(message) {
    const id = message.id || uuidv4();
    
    // Try to match phone to an assignee to find project/milestone
    const assignee = this.get(`
      SELECT ma.*, tm.project_id, tm.id as milestone_id 
      FROM milestone_assignees ma
      JOIN tracked_milestones tm ON ma.milestone_id = tm.id
      WHERE ma.phone LIKE ?
      ORDER BY ma.created_at DESC
      LIMIT 1
    `, [`%${message.from_phone.slice(-10)}%`]);

    this.run(`
      INSERT INTO whatsapp_messages (id, from_phone, from_name, message, project_id, milestone_id, wa_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      message.from_phone,
      this.nullify(message.from_name),
      message.message,
      assignee?.project_id || null,
      assignee?.milestone_id || null,
      this.nullify(message.wa_message_id)
    ]);

    // Log activity if we found a matching project
    if (assignee?.project_id) {
      this.logProjectActivity(
        assignee.project_id,
        'whatsapp_received',
        `Message from ${message.from_name || message.from_phone}: "${message.message.substring(0, 100)}"`,
        assignee.milestone_id
      );
    }

    return { id, matched_project: assignee?.project_id, matched_milestone: assignee?.milestone_id };
  }

  getProjectWhatsAppMessages(projectId, limit = 20) {
    return this.all(`
      SELECT * FROM whatsapp_messages 
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [projectId, limit]);
  }

  getRecentWhatsAppMessages(limit = 50) {
    return this.all(`
      SELECT wm.*, tp.title as project_title, tm.title as milestone_title
      FROM whatsapp_messages wm
      LEFT JOIN tracked_projects tp ON wm.project_id = tp.id
      LEFT JOIN tracked_milestones tm ON wm.milestone_id = tm.id
      ORDER BY wm.created_at DESC
      LIMIT ?
    `, [limit]);
  }
}

// Singleton instance
let instance = null;

export async function getDatabase() {
  if (!instance) {
    const dbPath = process.env.WORKSPACE_ROOT
      ? `${process.env.WORKSPACE_ROOT}/data/research.db`
      : './data/research.db';
    instance = new ResearchDatabase(dbPath);
    await instance.initialize();
  }
  return instance;
}

export default ResearchDatabase;
