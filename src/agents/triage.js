import BaseAgent from './base_agent.js';

class TriageAgent extends BaseAgent {
  constructor() {
    super('triage', {
      name: 'Triage',
      role: 'Discovery Prioritization Agent'
    });
  }

  async scoreDiscoveries(discoveries) {
    const db = await this.ensureDb();

    const prompt = `
You are scoring research discoveries for priority. Score each on these criteria:

1. **Relevance** (0-30): How relevant to our focus areas?
   - Myostatin/GLP-1/muscle preservation
   - Surgical AI/endoscopy technology
   - Bariatric procedures
   - Digital twins/cardiometabolic

2. **Novelty** (0-25): Does this challenge assumptions or reveal new opportunities?

3. **Actionability** (0-25): Can we do something with this?
   - Could inform a grant application
   - Could affect product development
   - Could change clinical practice
   - Could strengthen investor narrative

4. **Urgency** (0-20): Is this time-sensitive?
   - Competitor news = urgent
   - New clinical trial = medium
   - Background research = low

Score each discovery and classify as:
- HIGH (70-100): Deep dive with full pipeline
- MEDIUM (40-69): Quick validation by Sage
- LOW (0-39): Archive for later

Return JSON format:
{
  "scores": [
    {
      "discovery_id": "...",
      "relevance": 25,
      "novelty": 20,
      "actionability": 15,
      "urgency": 10,
      "total": 70,
      "priority": "high",
      "reasoning": "Brief explanation"
    }
  ]
}

Discoveries to score:
${discoveries.map((d, i) => `
[${i + 1}] ID: ${d.id}
Title: ${d.title}
Source: ${d.source}
Abstract: ${(d.abstract || '').substring(0, 500)}
Keywords: ${(d.keywords || []).join(', ')}
`).join('\n---\n')}
`;

    const response = await this.chat(prompt);
    const parsed = this.parseJsonResponse(response);

    if (parsed && parsed.scores) {
      // Update database with scores
      for (const score of parsed.scores) {
        const discovery = discoveries.find(d => d.id === score.discovery_id);
        if (discovery) {
          db.run(`
            UPDATE discoveries
            SET relevance_score = ?, priority = ?
            WHERE id = ?
          `, [score.total, score.priority, score.discovery_id]);
        }
      }

      db.logActivity(
        this.agentId,
        'score_discoveries',
        'discovery',
        null,
        `Scored ${parsed.scores.length} discoveries: ${parsed.scores.filter(s => s.priority === 'high').length} high priority`
      );
    }

    return parsed;
  }

  async process(discoveries) {
    return this.scoreDiscoveries(discoveries);
  }
}

export default TriageAgent;
