import { parseStringPromise } from 'xml2js';

const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const RATE_LIMIT_MS = 350; // ~3 requests per second without API key

class PubMedAPI {
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

  buildUrl(endpoint, params) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    if (this.apiKey) {
      params.api_key = this.apiKey;
    }
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  }

  async search(query, options = {}) {
    const {
      maxResults = 20,
      minDate = null,
      maxDate = null,
      sortBy = 'relevance', // 'relevance' or 'date'
      originalStudiesOnly = true // Filter out reviews, meta-analyses, etc.
    } = options;

    await this.rateLimitWait();

    // Build date range
    let dateRange = '';
    if (minDate) {
      const max = maxDate || new Date().toISOString().split('T')[0];
      dateRange = `&datetype=pdat&mindate=${minDate}&maxdate=${max}`;
    }

    // Add filter for original studies only (exclude reviews, meta-analyses, systematic reviews)
    let filteredQuery = query;
    if (originalStudiesOnly) {
      filteredQuery = `(${query}) NOT (Review[pt] OR Systematic Review[pt] OR Meta-Analysis[pt] OR "review"[Title] OR "systematic review"[Title] OR "meta-analysis"[Title])`;
    }

    // Search for PMIDs
    const searchUrl = this.buildUrl('esearch.fcgi', {
      db: 'pubmed',
      term: filteredQuery,
      retmax: maxResults,
      sort: sortBy === 'date' ? 'pub_date' : 'relevance',
      retmode: 'json'
    }) + dateRange;

    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();

    const pmids = searchData.esearchresult?.idlist || [];
    if (pmids.length === 0) {
      return [];
    }

    // Fetch details for each PMID
    return this.fetchDetails(pmids);
  }

  async fetchDetails(pmids) {
    if (!pmids.length) return [];

    await this.rateLimitWait();

    const fetchUrl = this.buildUrl('efetch.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'xml'
    });

    const response = await fetch(fetchUrl);
    const xml = await response.text();

    return this.parseArticles(xml);
  }

  async parseArticles(xml) {
    const result = await parseStringPromise(xml, { explicitArray: false });
    const articles = result.PubmedArticleSet?.PubmedArticle;

    if (!articles) return [];

    const articleArray = Array.isArray(articles) ? articles : [articles];

    return articleArray.map(article => {
      const medline = article.MedlineCitation;
      const articleData = medline?.Article;
      const pubmedData = article.PubmedData;

      // Extract authors
      const authorList = articleData?.AuthorList?.Author;
      const authors = authorList
        ? (Array.isArray(authorList) ? authorList : [authorList])
            .map(a => `${a.ForeName || ''} ${a.LastName || ''}`.trim())
            .filter(Boolean)
        : [];

      // Extract MeSH terms
      const meshList = medline?.MeshHeadingList?.MeshHeading;
      const meshTerms = meshList
        ? (Array.isArray(meshList) ? meshList : [meshList])
            .map(m => m.DescriptorName?._ || m.DescriptorName)
            .filter(Boolean)
        : [];

      // Extract keywords
      const keywordList = medline?.KeywordList?.Keyword;
      const keywords = keywordList
        ? (Array.isArray(keywordList) ? keywordList : [keywordList])
            .map(k => k._ || k)
            .filter(Boolean)
        : [];

      // Extract abstract
      const abstractTexts = articleData?.Abstract?.AbstractText;
      let abstract = '';
      if (abstractTexts) {
        if (Array.isArray(abstractTexts)) {
          abstract = abstractTexts.map(t => t._ || t).join(' ');
        } else {
          abstract = abstractTexts._ || abstractTexts;
        }
      }

      // Extract publication date
      const pubDate = articleData?.Journal?.JournalIssue?.PubDate;
      const year = pubDate?.Year || pubDate?.MedlineDate?.substring(0, 4) || '';
      const month = pubDate?.Month || '01';
      const day = pubDate?.Day || '01';

      // Convert month name to number if needed
      const monthNum = isNaN(month) ? this.monthToNumber(month) : month;

      return {
        source: 'pubmed',
        external_id: medline?.PMID?._ || medline?.PMID,
        title: articleData?.ArticleTitle?._ || articleData?.ArticleTitle || '',
        abstract,
        authors,
        publication_date: year ? `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
        journal: articleData?.Journal?.Title || '',
        url: `https://pubmed.ncbi.nlm.nih.gov/${medline?.PMID?._ || medline?.PMID}/`,
        mesh_terms: meshTerms,
        keywords,
        metadata: {
          pmid: medline?.PMID?._ || medline?.PMID,
          doi: this.extractDOI(pubmedData),
          publicationTypes: this.extractPubTypes(articleData)
        }
      };
    });
  }

  monthToNumber(month) {
    const months = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
      'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
      'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    return months[month.toLowerCase().substring(0, 3)] || '01';
  }

  extractDOI(pubmedData) {
    const idList = pubmedData?.ArticleIdList?.ArticleId;
    if (!idList) return null;
    const ids = Array.isArray(idList) ? idList : [idList];
    const doi = ids.find(id => id.$?.IdType === 'doi');
    return doi?._ || doi || null;
  }

  extractPubTypes(articleData) {
    const types = articleData?.PublicationTypeList?.PublicationType;
    if (!types) return [];
    return (Array.isArray(types) ? types : [types])
      .map(t => t._ || t)
      .filter(Boolean);
  }

  // Search by MeSH terms
  async searchByMesh(meshTerms, options = {}) {
    const query = meshTerms.map(t => `"${t}"[MeSH Terms]`).join(' OR ');
    return this.search(query, options);
  }

  // Search for recent papers in domain
  async searchDomain(domain, daysBack = 30) {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - daysBack);

    const keywordQuery = domain.keywords.map(k => `"${k}"`).join(' OR ');

    return this.search(keywordQuery, {
      maxResults: 50,
      minDate: minDate.toISOString().split('T')[0],
      sortBy: 'date'
    });
  }
}

export default PubMedAPI;
