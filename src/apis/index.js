import PubMedAPI from './pubmed.js';
import SemanticScholarAPI from './semantic_scholar.js';
import ClinicalTrialsAPI from './clinical_trials.js';
import PMCAPI from './pmc.js';

class APIManager {
  constructor() {
    this.pubmed = new PubMedAPI();
    this.semanticScholar = new SemanticScholarAPI();
    this.clinicalTrials = new ClinicalTrialsAPI();
    this.pmc = new PMCAPI();
  }

  // Try to enrich a discovery with full text from PMC
  async enrichWithFullText(discovery) {
    return this.pmc.enrichWithFullText(discovery);
  }

  async searchAll(query, options = {}) {
    const { sources = ['pubmed', 'semantic_scholar'], ...searchOptions } = options;

    const results = [];
    const errors = [];

    for (const source of sources) {
      try {
        let sourceResults = [];

        switch (source) {
          case 'pubmed':
            sourceResults = await this.pubmed.search(query, searchOptions);
            break;
          case 'semantic_scholar':
            sourceResults = await this.semanticScholar.search(query, searchOptions);
            break;
          case 'clinical_trials':
            sourceResults = await this.clinicalTrials.search(query, searchOptions);
            break;
        }

        results.push(...sourceResults);
      } catch (error) {
        errors.push({ source, error: error.message });
      }
    }

    // Deduplicate by title similarity
    const deduped = this.deduplicateResults(results);

    return {
      results: deduped,
      errors,
      totalBeforeDedup: results.length,
      totalAfterDedup: deduped.length
    };
  }

  deduplicateResults(results) {
    const seen = new Map();

    return results.filter(item => {
      // Normalize title for comparison
      const normalizedTitle = item.title.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 100);

      if (seen.has(normalizedTitle)) {
        // Keep the one with more data (longer abstract, more citations)
        const existing = seen.get(normalizedTitle);
        if ((item.abstract?.length || 0) > (existing.abstract?.length || 0) ||
            (item.citation_count || 0) > (existing.citation_count || 0)) {
          seen.set(normalizedTitle, item);
        }
        return false;
      }

      seen.set(normalizedTitle, item);
      return true;
    });
  }

  // Search across a research domain
  async searchDomain(domain, daysBack = 30) {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - daysBack);
    const minDateStr = minDate.toISOString().split('T')[0];

    const keywordQuery = domain.keywords.join(' OR ');

    const [pubmedResults, ssResults, ctResults] = await Promise.allSettled([
      this.pubmed.search(keywordQuery, { maxResults: 30, minDate: minDateStr }),
      this.semanticScholar.search(keywordQuery, { limit: 30 }),
      this.clinicalTrials.search(keywordQuery, { maxResults: 10 })
    ]);

    const results = [];

    if (pubmedResults.status === 'fulfilled') {
      results.push(...pubmedResults.value);
    }
    if (ssResults.status === 'fulfilled') {
      results.push(...ssResults.value);
    }
    if (ctResults.status === 'fulfilled') {
      results.push(...ctResults.value);
    }

    return this.deduplicateResults(results);
  }

  // Get citation network for a paper
  async getCitationNetwork(paperId, depth = 1) {
    const paper = await this.semanticScholar.getPaper(paperId);

    if (depth === 0) {
      return { paper, citations: [], references: [] };
    }

    const [citations, references] = await Promise.all([
      this.semanticScholar.getCitations(paperId, 20),
      this.semanticScholar.getReferences(paperId, 20)
    ]);

    return {
      paper,
      citations,
      references
    };
  }
}

export default APIManager;
