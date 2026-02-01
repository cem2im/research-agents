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
