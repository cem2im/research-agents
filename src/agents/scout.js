import BaseAgent from './base_agent.js';
import APIManager from '../apis/index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

class ScoutAgent extends BaseAgent {
  constructor() {
    super('scout', {
      name: 'Scout',
      role: 'Discovery & Data Ingestion Agent'
    });
    this.apiManager = new APIManager();
    this.schedule = this.loadSchedule();
  }

  loadSchedule() {
    const schedulePath = join(process.env.WORKSPACE_ROOT || '.', 'config', 'schedule.json');
    if (existsSync(schedulePath)) {
      try {
        return JSON.parse(readFileSync(schedulePath, 'utf-8'));
      } catch (e) {
        console.error('Error loading schedule:', e.message);
      }
    }
    return null;
  }

  // Get today's domain based on day of week
  getTodaysDomain() {
    if (!this.schedule) return null;

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];
    const todayConfig = this.schedule.rotation?.[today];

    if (!todayConfig || todayConfig.domain === 'none') {
      return null;
    }

    return todayConfig;
  }

  async searchDomain(domain, daysBack = 30) {
    const db = await this.ensureDb();
    const results = await this.apiManager.searchDomain(domain, daysBack);

    // Store discoveries in database
    for (const result of results) {
      const id = db.insertDiscovery(result);
      result.id = id;

      // Add to vector store
      try {
        await this.vectorStore.addDiscovery(result);
      } catch (e) {
        // Vector store might fail
      }
    }

    db.logActivity(
      this.agentId,
      'domain_search',
      'discovery',
      null,
      `Found ${results.length} items for domain: ${domain.name}`
    );

    return results;
  }

  async searchQuery(query, options = {}) {
    const db = await this.ensureDb();

    // Default to last 30 days
    const defaultMinDate = new Date();
    defaultMinDate.setDate(defaultMinDate.getDate() - 30);

    const searchOptions = {
      minDate: defaultMinDate.toISOString().split('T')[0],
      ...options
    };

    const { results, errors } = await this.apiManager.searchAll(query, searchOptions);

    // Store discoveries
    for (const result of results) {
      const id = db.insertDiscovery(result);
      result.id = id;
      try {
        await this.vectorStore.addDiscovery(result);
      } catch (e) {
        // Vector store might fail
      }
    }

    db.logActivity(
      this.agentId,
      'query_search',
      'discovery',
      null,
      `Query "${query}" returned ${results.length} results`
    );

    return { results, errors };
  }

  // Enrich a discovery with full text from PMC
  async enrichWithFullText(discovery) {
    const db = await this.ensureDb();

    // Check if we already have full text cached
    const cached = db.getFullText(discovery.id);
    if (cached) {
      return { ...discovery, ...cached, fullTextAvailable: true };
    }

    // Try to fetch from PMC
    const enriched = await this.apiManager.enrichWithFullText(discovery);

    // Cache if we got full text
    if (enriched.fullTextAvailable && enriched.fullText) {
      db.cacheFullText(discovery.id, enriched.pmcid, enriched.fullText, enriched.sections);
    }

    return enriched;
  }

  // Enrich multiple discoveries with full text
  async enrichBatchWithFullText(discoveries, maxToEnrich = 5) {
    const enriched = [];
    let enrichedCount = 0;

    for (const discovery of discoveries) {
      if (enrichedCount >= maxToEnrich) {
        enriched.push(discovery);
        continue;
      }

      try {
        const result = await this.enrichWithFullText(discovery);
        enriched.push(result);
        if (result.fullTextAvailable) {
          enrichedCount++;
          console.log(`  Full text available for: ${discovery.title.substring(0, 50)}...`);
        }
      } catch (e) {
        enriched.push(discovery);
      }
    }

    return enriched;
  }

  // Daily scan based on schedule rotation
  async dailyScan() {
    const db = await this.ensureDb();
    const todayConfig = this.getTodaysDomain();

    if (!todayConfig) {
      console.log('No scan scheduled for today');
      return [];
    }

    const allResults = [];
    const daysBack = this.schedule?.settings?.daysBack || 30;

    if (todayConfig.domain === 'all') {
      // Scan all domains
      const domains = db.getActiveDomains();
      for (const domain of domains) {
        try {
          const results = await this.searchDomain(domain, daysBack);
          allResults.push({
            domain: domain.name,
            count: results.length,
            results
          });
        } catch (error) {
          console.error(`Error scanning domain ${domain.name}:`, error.message);
        }
      }
    } else {
      // Scan single domain
      const domain = db.getDomain(todayConfig.domain);
      if (domain) {
        try {
          const results = await this.searchDomain(domain, daysBack);
          allResults.push({
            domain: domain.name,
            count: results.length,
            results
          });
        } catch (error) {
          console.error(`Error scanning domain ${domain.name}:`, error.message);
        }
      }
    }

    db.logActivity(
      this.agentId,
      'daily_scan',
      null,
      null,
      `${todayConfig.name}: Found ${allResults.reduce((s, r) => s + r.count, 0)} items`
    );

    return allResults;
  }

  async getCitationNetwork(paperId) {
    return this.apiManager.getCitationNetwork(paperId);
  }
}

export default ScoutAgent;
