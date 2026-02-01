import BaseAgent from './base_agent.js';
import APIManager from '../apis/index.js';

class SageAgent extends BaseAgent {
  constructor() {
    super('sage', {
      name: 'Sage',
      role: 'Hypothesis Validation Agent'
    });
    this.apiManager = new APIManager();
  }

  async validateHypothesis(hypothesis) {
    const db = await this.ensureDb();

    // First, search for relevant literature
    const searchQuery = `${hypothesis.title} ${hypothesis.statement}`.substring(0, 200);
    let literatureResults = [];

    try {
      const { results } = await this.apiManager.searchAll(searchQuery, {
        sources: ['pubmed', 'semantic_scholar'],
        maxResults: 15
      });
      literatureResults = results;
    } catch (e) {
      console.error('Literature search failed:', e.message);
    }

    const literatureSummary = literatureResults.length > 0
      ? literatureResults.map(r => `- ${r.title} (${r.source}): ${(r.abstract || '').substring(0, 200)}`).join('\n')
      : 'No relevant literature found in automated search.';

    const prompt = `
Validate this hypothesis by analyzing available evidence.

Hypothesis:
- Title: ${hypothesis.title}
- Statement: ${hypothesis.statement}
- Rationale: ${hypothesis.rationale || 'Not provided'}
- Assumptions: ${(hypothesis.assumptions || []).join('; ')}
- Testable Predictions: ${(hypothesis.testable_predictions || []).join('; ')}

Relevant Literature Found:
${literatureSummary}

Analyze:
1. **Supporting Evidence**: What literature supports this hypothesis?
2. **Contradicting Evidence**: What challenges or contradicts it?
3. **Gaps**: What evidence is missing?
4. **Key Papers**: Which papers are most important to read?
5. **Confidence Assessment**: How confident can we be?

Return JSON format:
{
  "supporting_evidence": [
    {"source": "paper title", "summary": "how it supports", "strength": "strong|moderate|weak"}
  ],
  "contradicting_evidence": [
    {"source": "paper title", "summary": "how it contradicts", "strength": "strong|moderate|weak"}
  ],
  "gaps_identified": ["Gap 1", "Gap 2"],
  "key_papers": ["PMID or DOI 1", "PMID or DOI 2"],
  "confidence_level": "high|medium|low|insufficient",
  "recommendation": "pursue|modify|reject|needs_more_research",
  "summary": "Brief summary of validation findings and recommendation",
  "suggested_modifications": "If recommendation is 'modify', what changes would strengthen the hypothesis?"
}
`;

    const response = await this.chat(prompt);
    const parsed = this.parseJsonResponse(response);

    if (parsed) {
      const validationId = db.insertValidation({
        hypothesis_id: hypothesis.id,
        supporting_evidence: parsed.supporting_evidence,
        contradicting_evidence: parsed.contradicting_evidence,
        gaps_identified: parsed.gaps_identified,
        key_papers: parsed.key_papers,
        confidence_level: parsed.confidence_level,
        recommendation: parsed.recommendation,
        summary: parsed.summary
      });

      // Update hypothesis status
      const newStatus = parsed.recommendation === 'pursue' ? 'validated'
        : parsed.recommendation === 'reject' ? 'rejected'
        : 'validating';
      db.updateHypothesisStatus(hypothesis.id, newStatus);

      // Add to vector store
      try {
        await this.vectorStore.addValidation({ ...parsed, id: validationId, hypothesis_id: hypothesis.id });
      } catch (e) {
        // Vector store might fail
      }

      db.logActivity(
        this.agentId,
        'validate_hypothesis',
        'validation',
        validationId,
        `Validated hypothesis "${hypothesis.title}": ${parsed.recommendation} (${parsed.confidence_level} confidence)`
      );

      return { ...parsed, id: validationId };
    }

    return null;
  }

  async process(hypothesis) {
    return this.validateHypothesis(hypothesis);
  }
}

export default SageAgent;
