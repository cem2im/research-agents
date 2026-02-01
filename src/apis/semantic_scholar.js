const BASE_URL = 'https://api.semanticscholar.org/graph/v1';
const RATE_LIMIT_MS = 1000; // 1 request per second for free tier

class SemanticScholarAPI {
  constructor() {
    this.lastRequest = 0;
  }

  async rateLimitWait() {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    this.lastRequest = Date.now();
  }

  async search(query, options = {}) {
    const { limit = 20, fields = null } = options;

    await this.rateLimitWait();

    const defaultFields = [
      'paperId', 'title', 'abstract', 'year', 'citationCount',
      'influentialCitationCount', 'authors', 'journal', 'url',
      'publicationDate', 'fieldsOfStudy'
    ];

    const params = new URLSearchParams({
      query,
      limit,
      fields: (fields || defaultFields).join(',')
    });

    const response = await fetch(`${BASE_URL}/paper/search?${params}`);

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();

    return (data.data || []).map(paper => this.normalizePaper(paper));
  }

  async getPaper(paperId) {
    await this.rateLimitWait();

    const fields = [
      'paperId', 'title', 'abstract', 'year', 'citationCount',
      'influentialCitationCount', 'authors', 'journal', 'url',
      'publicationDate', 'fieldsOfStudy', 'citations', 'references'
    ];

    const response = await fetch(
      `${BASE_URL}/paper/${paperId}?fields=${fields.join(',')}`
    );

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    return this.normalizePaper(await response.json());
  }

  async getCitations(paperId, limit = 50) {
    await this.rateLimitWait();

    const fields = 'paperId,title,abstract,year,citationCount,authors';
    const response = await fetch(
      `${BASE_URL}/paper/${paperId}/citations?fields=${fields}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.data || []).map(item => this.normalizePaper(item.citingPaper));
  }

  async getReferences(paperId, limit = 50) {
    await this.rateLimitWait();

    const fields = 'paperId,title,abstract,year,citationCount,authors';
    const response = await fetch(
      `${BASE_URL}/paper/${paperId}/references?fields=${fields}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.data || []).map(item => this.normalizePaper(item.citedPaper));
  }

  async getAuthor(authorId) {
    await this.rateLimitWait();

    const fields = 'authorId,name,affiliations,paperCount,citationCount,hIndex';
    const response = await fetch(
      `${BASE_URL}/author/${authorId}?fields=${fields}`
    );

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    return response.json();
  }

  async getAuthorPapers(authorId, limit = 20) {
    await this.rateLimitWait();

    const fields = 'paperId,title,year,citationCount,abstract';
    const response = await fetch(
      `${BASE_URL}/author/${authorId}/papers?fields=${fields}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.data || []).map(this.normalizePaper.bind(this));
  }

  normalizePaper(paper) {
    if (!paper) return null;

    return {
      source: 'semantic_scholar',
      external_id: paper.paperId,
      title: paper.title || '',
      abstract: paper.abstract || '',
      authors: (paper.authors || []).map(a => a.name),
      publication_date: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : null),
      journal: paper.journal?.name || paper.venue || '',
      url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
      citation_count: paper.citationCount || 0,
      influence_score: paper.influentialCitationCount || 0,
      keywords: paper.fieldsOfStudy || [],
      mesh_terms: [],
      metadata: {
        paperId: paper.paperId,
        influentialCitationCount: paper.influentialCitationCount,
        fieldsOfStudy: paper.fieldsOfStudy
      }
    };
  }

  // Calculate influence score (0-100)
  calculateInfluenceScore(paper) {
    const citations = paper.citation_count || 0;
    const influential = paper.influence_score || 0;

    // Log scale for citations, bonus for influential citations
    const citationScore = Math.min(Math.log10(citations + 1) * 20, 60);
    const influenceBonus = Math.min(influential * 2, 40);

    return Math.round(citationScore + influenceBonus);
  }
}

export default SemanticScholarAPI;
