import { parseStringPromise } from 'xml2js';

const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PMC_OA_URL = 'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi';
const RATE_LIMIT_MS = 350;

/**
 * PubMed Central API for fetching full-text open access articles
 */
class PMCAPI {
  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.NCBI_API_KEY;
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

  /**
   * Check if a PMID has a PMC full-text version
   */
  async getPMCID(pmid) {
    await this.rateLimitWait();

    const url = `${BASE_URL}/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      const linksets = data.linksets?.[0]?.linksetdbs;
      if (!linksets) return null;

      const pmcLink = linksets.find(l => l.dbto === 'pmc');
      if (pmcLink && pmcLink.links?.[0]) {
        return `PMC${pmcLink.links[0]}`;
      }
    } catch (e) {
      console.error('PMC lookup error:', e.message);
    }

    return null;
  }

  /**
   * Get full text from PMC
   */
  async getFullText(pmcid) {
    await this.rateLimitWait();

    const url = `${BASE_URL}/efetch.fcgi?db=pmc&id=${pmcid}&rettype=full&retmode=xml`;

    try {
      const response = await fetch(url);
      const xml = await response.text();

      return this.parseFullText(xml);
    } catch (e) {
      console.error('PMC fetch error:', e.message);
      return null;
    }
  }

  /**
   * Parse PMC XML to extract text sections
   */
  async parseFullText(xml) {
    try {
      const result = await parseStringPromise(xml, {
        explicitArray: false,
        ignoreAttrs: true
      });

      const article = result['pmc-articleset']?.article || result.article;
      if (!article) return null;

      const body = article.body;
      const sections = [];

      // Extract text from sections
      if (body?.sec) {
        const secs = Array.isArray(body.sec) ? body.sec : [body.sec];
        for (const sec of secs) {
          const section = this.extractSection(sec);
          if (section) sections.push(section);
        }
      }

      // Extract abstract
      const abstractEl = article.front?.['article-meta']?.abstract;
      let abstract = '';
      if (abstractEl) {
        abstract = this.extractText(abstractEl);
      }

      return {
        abstract,
        sections,
        fullText: sections.map(s => `## ${s.title}\n${s.text}`).join('\n\n'),
        hasFullText: sections.length > 0
      };
    } catch (e) {
      console.error('PMC parse error:', e.message);
      return null;
    }
  }

  extractSection(sec) {
    if (!sec) return null;

    const title = sec.title || 'Untitled Section';
    let text = '';

    // Extract paragraphs
    if (sec.p) {
      const paragraphs = Array.isArray(sec.p) ? sec.p : [sec.p];
      text = paragraphs.map(p => this.extractText(p)).join('\n\n');
    }

    // Recurse into subsections
    if (sec.sec) {
      const subsecs = Array.isArray(sec.sec) ? sec.sec : [sec.sec];
      for (const subsec of subsecs) {
        const sub = this.extractSection(subsec);
        if (sub) {
          text += `\n\n### ${sub.title}\n${sub.text}`;
        }
      }
    }

    return { title, text };
  }

  extractText(element) {
    if (typeof element === 'string') return element;
    if (element._) return element._;
    if (typeof element === 'object') {
      return Object.values(element)
        .map(v => this.extractText(v))
        .filter(Boolean)
        .join(' ');
    }
    return '';
  }

  /**
   * Try to get full text for a discovery (by PMID)
   */
  async enrichWithFullText(discovery) {
    if (discovery.source !== 'pubmed') {
      return discovery;
    }

    const pmid = discovery.external_id || discovery.metadata?.pmid;
    if (!pmid) return discovery;

    // Check for PMC version
    const pmcid = await this.getPMCID(pmid);
    if (!pmcid) {
      return { ...discovery, fullTextAvailable: false };
    }

    // Fetch full text
    const fullText = await this.getFullText(pmcid);
    if (!fullText) {
      return { ...discovery, fullTextAvailable: false, pmcid };
    }

    return {
      ...discovery,
      fullTextAvailable: true,
      pmcid,
      fullText: fullText.fullText,
      sections: fullText.sections,
      metadata: {
        ...discovery.metadata,
        pmcid,
        hasFullText: true
      }
    };
  }
}

export default PMCAPI;
