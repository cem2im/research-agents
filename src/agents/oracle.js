import BaseAgent from './base_agent.js';

class OracleAgent extends BaseAgent {
  constructor() {
    super('oracle', {
      name: 'Oracle',
      role: 'Hypothesis Generation Agent'
    });
  }

  async generateHypotheses(discovery) {
    const db = await this.ensureDb();

    const prompt = `
Based on this research discovery, generate 1-3 testable hypotheses relevant to our work.

Discovery:
- Title: ${discovery.title}
- Source: ${discovery.source}
- Abstract: ${discovery.abstract || 'No abstract available'}
- Keywords: ${(discovery.keywords || []).join(', ')}

Our Focus Areas:
1. Muscleon: Myostatin inhibitors for muscle preservation during GLP-1 therapy
2. Diagnis/SCAI: AI-powered surgical coaching for endoscopy
3. Cemiendo: Bariatric endoscopy practice
4. Academic: Digital twins, cardiometabolic care, grant applications

For each hypothesis, provide:
- A clear, testable statement
- The rationale connecting this discovery to our work
- Key assumptions being made
- Specific testable predictions
- Required evidence to validate/invalidate
- Potential impact if validated

Return JSON format:
{
  "hypotheses": [
    {
      "title": "Short descriptive title",
      "statement": "If X, then Y, because Z",
      "rationale": "This connects to our work because...",
      "assumptions": ["Assumption 1", "Assumption 2"],
      "testable_predictions": ["If true, we should see...", "We could test by..."],
      "required_evidence": ["Literature showing...", "Data demonstrating..."],
      "potential_impact": "This could enable/inform/change...",
      "confidence_score": 0.7,
      "relevant_company": "muscleon|diagnis|cemiendo|academic"
    }
  ]
}
`;

    const response = await this.chat(prompt);
    const parsed = this.parseJsonResponse(response);

    if (parsed && parsed.hypotheses) {
      const savedHypotheses = [];

      for (const hyp of parsed.hypotheses) {
        const id = db.insertHypothesis({
          discovery_id: discovery.id,
          title: hyp.title,
          statement: hyp.statement,
          rationale: hyp.rationale,
          assumptions: hyp.assumptions,
          testable_predictions: hyp.testable_predictions,
          required_evidence: hyp.required_evidence,
          potential_impact: hyp.potential_impact,
          confidence_score: hyp.confidence_score
        });

        const savedHyp = { ...hyp, id, discovery_id: discovery.id };
        savedHypotheses.push(savedHyp);

        // Add to vector store
        try {
          await this.vectorStore.addHypothesis(savedHyp);
        } catch (e) {
          // Vector store might fail
        }
      }

      db.logActivity(
        this.agentId,
        'generate_hypotheses',
        'hypothesis',
        null,
        `Generated ${savedHypotheses.length} hypotheses from discovery: ${discovery.title.substring(0, 50)}`
      );

      return savedHypotheses;
    }

    return [];
  }

  async process(discovery) {
    return this.generateHypotheses(discovery);
  }
}

export default OracleAgent;
