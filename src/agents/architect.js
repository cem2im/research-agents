import BaseAgent from './base_agent.js';

class ArchitectAgent extends BaseAgent {
  constructor() {
    super('architect', {
      name: 'Architect',
      role: 'Project Design Agent'
    });
  }

  async designProject(hypothesis, validation) {
    const db = await this.ensureDb();

    const prompt = `
Design a research/development project based on this validated hypothesis.

Hypothesis:
- Title: ${hypothesis.title}
- Statement: ${hypothesis.statement}
- Impact: ${hypothesis.potential_impact || 'Not specified'}

Validation Results:
- Confidence: ${validation.confidence_level}
- Recommendation: ${validation.recommendation}
- Summary: ${validation.summary}
- Gaps to Address: ${(validation.gaps_identified || []).join('; ')}

Context - Our Entities:
1. **Muscleon** (Pre-seed biotech): Developing myostatin inhibitors for muscle preservation
2. **Diagnis/SCAI** (Startup): AI surgical coaching platform for endoscopy
3. **Cemiendo** (Clinical practice): Bariatric endoscopy procedures
4. **Hacettepe University** (Academic): Digital twins, grants, publications

Design a project that:
- Has clear, measurable objectives
- Fits our capabilities and resources
- Has realistic milestones
- Addresses identified gaps

Return JSON format:
{
  "title": "Project title",
  "objective": "What we aim to achieve",
  "output_type": "grant|trial|product|publication",
  "target_entity": "muscleon|diagnis|cemiendo|academic",
  "methodology": "How we will approach this",
  "milestones": [
    {"name": "Milestone 1", "deliverable": "What", "week": 4},
    {"name": "Milestone 2", "deliverable": "What", "week": 8}
  ],
  "resources_required": [
    {"type": "personnel|equipment|data|funding", "description": "What's needed", "estimated_cost_usd": 5000}
  ],
  "timeline_weeks": 12,
  "estimated_cost_usd": 50000,
  "feasibility_score": 0.8,
  "risk_assessment": "Key risks and their likelihood",
  "success_metrics": ["Metric 1", "Metric 2"],
  "next_steps": ["Immediate action 1", "Immediate action 2"]
}
`;

    const response = await this.chat(prompt);
    const parsed = this.parseJsonResponse(response);

    if (parsed) {
      const projectId = db.insertProject({
        hypothesis_id: hypothesis.id,
        title: parsed.title,
        objective: parsed.objective,
        methodology: parsed.methodology,
        milestones: parsed.milestones,
        resources_required: parsed.resources_required,
        timeline_weeks: parsed.timeline_weeks,
        estimated_cost_usd: parsed.estimated_cost_usd,
        output_type: parsed.output_type,
        feasibility_score: parsed.feasibility_score,
        risk_assessment: parsed.risk_assessment
      });

      // Update hypothesis status
      db.updateHypothesisStatus(hypothesis.id, 'project');

      // Add to vector store
      try {
        await this.vectorStore.addProject({ ...parsed, id: projectId, hypothesis_id: hypothesis.id });
      } catch (e) {
        // Vector store might fail
      }

      db.logActivity(
        this.agentId,
        'design_project',
        'project',
        projectId,
        `Designed project "${parsed.title}" (${parsed.output_type}) - ${parsed.timeline_weeks} weeks, $${parsed.estimated_cost_usd}`
      );

      return { ...parsed, id: projectId };
    }

    return null;
  }

  async process(hypothesis, validation) {
    return this.designProject(hypothesis, validation);
  }
}

export default ArchitectAgent;
