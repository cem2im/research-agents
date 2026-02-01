import BaseAgent from './base_agent.js';

class AdversaryAgent extends BaseAgent {
  constructor() {
    super('adversary', {
      name: 'Adversary',
      role: 'Red Team & Critical Review Agent'
    });
  }

  async reviewProject(project, hypothesis) {
    const db = await this.ensureDb();

    const prompt = `
You are a skeptical red team reviewer. Your job is to find weaknesses, risks, and potential failures in this project. Be constructively critical.

Project:
- Title: ${project.title}
- Objective: ${project.objective}
- Output Type: ${project.output_type}
- Timeline: ${project.timeline_weeks} weeks
- Budget: $${project.estimated_cost_usd}
- Methodology: ${project.methodology}
- Milestones: ${(project.milestones || []).map(m => m.name).join(', ')}

Based on Hypothesis:
- Statement: ${hypothesis.statement}
- Assumptions: ${(hypothesis.assumptions || []).join('; ')}

Analyze from these perspectives:
1. **Scientific Validity**: Are the assumptions sound? Is the methodology rigorous?
2. **Market/Clinical**: Will anyone want this? What's the competitive landscape?
3. **Technical Feasibility**: Can this actually be built/done?
4. **Regulatory**: What regulatory hurdles exist?
5. **Resource Constraints**: Is the timeline/budget realistic?
6. **Opportunity Cost**: What else could we do with these resources?

Return JSON format:
{
  "critical_questions": [
    "Question that must be answered before proceeding"
  ],
  "weaknesses": [
    {"area": "scientific|market|technical|regulatory|resource", "issue": "Description", "severity": "critical|major|minor"}
  ],
  "risks": [
    {"risk": "What could go wrong", "likelihood": "high|medium|low", "impact": "high|medium|low", "mitigation": "How to reduce"}
  ],
  "competitor_threats": "Analysis of competitive landscape and threats",
  "regulatory_concerns": "Specific regulatory issues to consider",
  "recommended_mitigations": [
    "Action to address a weakness or risk"
  ],
  "overall_assessment": "proceed|revise|pause|abandon",
  "assessment_rationale": "Why this assessment",
  "key_success_factors": ["What must go right for this to succeed"],
  "recommended_pivots": "Alternative approaches if current plan fails"
}
`;

    const response = await this.chat(prompt);
    const parsed = this.parseJsonResponse(response);

    if (parsed) {
      const reviewId = db.insertReview({
        project_id: project.id,
        critical_questions: parsed.critical_questions,
        weaknesses: parsed.weaknesses,
        risks: parsed.risks,
        competitor_threats: parsed.competitor_threats,
        regulatory_concerns: parsed.regulatory_concerns,
        recommended_mitigations: parsed.recommended_mitigations,
        overall_assessment: parsed.overall_assessment
      });

      // Update project status based on assessment
      const statusMap = {
        'proceed': 'approved',
        'revise': 'revision_needed',
        'pause': 'paused',
        'abandon': 'rejected'
      };
      db.updateProjectStatus(project.id, statusMap[parsed.overall_assessment] || 'reviewed');

      db.logActivity(
        this.agentId,
        'review_project',
        'review',
        reviewId,
        `Reviewed project "${project.title}": ${parsed.overall_assessment} - ${parsed.weaknesses?.length || 0} weaknesses, ${parsed.risks?.length || 0} risks`
      );

      return { ...parsed, id: reviewId };
    }

    return null;
  }

  async process(project, hypothesis) {
    return this.reviewProject(project, hypothesis);
  }
}

export default AdversaryAgent;
