import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * File-based vector store with TF-IDF similarity
 * Persists automatically to disk - no external server needed
 */
class VectorStore {
  constructor() {
    this.documents = [];
    this.index = {};
    this.initialized = false;
    this.dbPath = null;
  }

  async initialize() {
    if (this.initialized) return;

    this.dbPath = process.env.WORKSPACE_ROOT
      ? join(process.env.WORKSPACE_ROOT, 'data', 'vector_db', 'store.json')
      : './data/vector_db/store.json';

    // Ensure directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing data
    if (existsSync(this.dbPath)) {
      try {
        const data = JSON.parse(readFileSync(this.dbPath, 'utf-8'));
        this.documents = data.documents || [];
        this.index = data.index || {};
      } catch (e) {
        this.documents = [];
        this.index = {};
      }
    }

    this.initialized = true;
  }

  save() {
    if (!this.dbPath) return;
    try {
      writeFileSync(this.dbPath, JSON.stringify({
        documents: this.documents,
        index: this.index,
        updated: new Date().toISOString()
      }, null, 2));
    } catch (e) {
      console.error('Error saving vector store:', e.message);
    }
  }

  // Tokenize and normalize text
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  // Calculate TF-IDF-like similarity
  calculateSimilarity(query, document) {
    const queryTokens = new Set(this.tokenize(query));
    const docTokens = this.tokenize(document);

    if (queryTokens.size === 0 || docTokens.length === 0) return 0;

    let matches = 0;
    const docTokenSet = new Set(docTokens);

    for (const token of queryTokens) {
      if (docTokenSet.has(token)) {
        const idf = this.index[token]
          ? Math.log((this.documents.length + 1) / this.index[token])
          : 1;
        matches += idf;
      }
    }

    return matches / Math.sqrt(queryTokens.size);
  }

  // Update term index
  updateIndex(document) {
    const tokens = new Set(this.tokenize(document));
    for (const token of tokens) {
      this.index[token] = (this.index[token] || 0) + 1;
    }
  }

  async addDocument(id, content, metadata) {
    await this.initialize();

    const existingIdx = this.documents.findIndex(d => d.id === id);

    if (existingIdx >= 0) {
      this.documents[existingIdx] = { id, content, metadata, updated: new Date().toISOString() };
    } else {
      this.documents.push({ id, content, metadata, created: new Date().toISOString() });
      this.updateIndex(content);
    }

    this.save();
  }

  async addDiscovery(discovery) {
    const content = `
TITLE: ${discovery.title}
SOURCE: ${discovery.source}
DATE: ${discovery.publication_date || 'Unknown'}
ABSTRACT: ${discovery.abstract || 'No abstract'}
KEYWORDS: ${(discovery.keywords || []).join(', ')}
MESH TERMS: ${(discovery.mesh_terms || []).join(', ')}
AUTHORS: ${(discovery.authors || []).join(', ')}
    `.trim();

    await this.addDocument(discovery.id || discovery.external_id, content, {
      type: 'discovery',
      source: discovery.source,
      external_id: discovery.external_id,
      title: discovery.title,
      date: discovery.publication_date || '',
      url: discovery.url || ''
    });
  }

  async addHypothesis(hypothesis) {
    const content = `
HYPOTHESIS: ${hypothesis.title}
STATEMENT: ${hypothesis.statement}
RATIONALE: ${hypothesis.rationale || ''}
ASSUMPTIONS: ${(hypothesis.assumptions || []).join('; ')}
PREDICTIONS: ${(hypothesis.testable_predictions || []).join('; ')}
IMPACT: ${hypothesis.potential_impact || ''}
    `.trim();

    await this.addDocument(`hypothesis_${hypothesis.id}`, content, {
      type: 'hypothesis',
      hypothesis_id: hypothesis.id,
      title: hypothesis.title,
      status: hypothesis.status || 'generated'
    });
  }

  async addValidation(validation) {
    const content = `
VALIDATION SUMMARY: ${validation.summary}
CONFIDENCE: ${validation.confidence_level}
RECOMMENDATION: ${validation.recommendation}
SUPPORTING EVIDENCE: ${(validation.supporting_evidence || []).map(e => e.summary || e).join('; ')}
CONTRADICTING EVIDENCE: ${(validation.contradicting_evidence || []).map(e => e.summary || e).join('; ')}
GAPS: ${(validation.gaps_identified || []).join('; ')}
    `.trim();

    await this.addDocument(`validation_${validation.id}`, content, {
      type: 'validation',
      validation_id: validation.id,
      hypothesis_id: validation.hypothesis_id,
      confidence: validation.confidence_level,
      recommendation: validation.recommendation
    });
  }

  async addProject(project) {
    const content = `
PROJECT: ${project.title}
OBJECTIVE: ${project.objective}
METHODOLOGY: ${project.methodology || ''}
TIMELINE: ${project.timeline_weeks} weeks
COST: $${project.estimated_cost_usd || 'TBD'}
OUTPUT TYPE: ${project.output_type}
MILESTONES: ${(project.milestones || []).join('; ')}
RESOURCES: ${(project.resources_required || []).join('; ')}
    `.trim();

    await this.addDocument(`project_${project.id}`, content, {
      type: 'project',
      project_id: project.id,
      title: project.title,
      output_type: project.output_type,
      status: project.status || 'drafted'
    });
  }

  async search(query, options = {}) {
    await this.initialize();

    const { limit = 10, type = null } = options;

    let candidates = this.documents;

    if (type) {
      candidates = candidates.filter(d => d.metadata?.type === type);
    }

    const scored = candidates.map(doc => ({
      ...doc,
      score: this.calculateSimilarity(query, doc.content)
    }));

    return scored
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(d => ({
        content: d.content,
        metadata: d.metadata,
        score: d.score
      }));
  }

  async findRelated(id, limit = 5) {
    await this.initialize();

    const doc = this.documents.find(d => d.id === id);
    if (!doc) return [];

    return (await this.search(doc.content, { limit: limit + 1 }))
      .filter(r => r.metadata?.id !== id)
      .slice(0, limit);
  }

  async getStats() {
    await this.initialize();
    return {
      totalDocuments: this.documents.length,
      indexTerms: Object.keys(this.index).length,
      byType: this.documents.reduce((acc, d) => {
        const type = d.metadata?.type || 'unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

// Singleton
let instance = null;

export function getVectorStore() {
  if (!instance) {
    instance = new VectorStore();
  }
  return instance;
}

export default VectorStore;
