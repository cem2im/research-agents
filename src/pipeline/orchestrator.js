import { getAgent } from '../agents/index.js';
import { getDatabase } from '../db/database.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

class PipelineOrchestrator {
  constructor() {
    this.db = null;
    this.scout = getAgent('scout');
    this.triage = getAgent('triage');
    this.oracle = getAgent('oracle');
    this.sage = getAgent('sage');
    this.architect = getAgent('architect');
    this.adversary = getAgent('adversary');
  }

  async ensureDb() {
    if (!this.db) {
      this.db = await getDatabase();
    }
    return this.db;
  }

  /**
   * Stage 1: Discovery
   * Scout searches for new research across all domains
   */
  async runDiscoveryStage(options = {}) {
    const db = await this.ensureDb();
    const { daysBack = 7, query = null } = options;

    console.log('\n📡 STAGE 1: DISCOVERY');
    console.log('─'.repeat(50));

    let results = [];

    if (query) {
      // Custom query search
      console.log(`Searching for: "${query}"`);
      const searchResults = await this.scout.searchQuery(query, {
        sources: ['pubmed', 'semantic_scholar', 'clinical_trials']
      });
      results = searchResults.results;
    } else {
      // Domain scan
      const scanResults = await this.scout.dailyScan();
      for (const domainResult of scanResults) {
        console.log(`  ${domainResult.domain}: ${domainResult.count} items`);
        results.push(...domainResult.results);
      }
    }

    console.log(`\n✓ Found ${results.length} discoveries`);
    return results;
  }

  /**
   * Stage 2: Triage
   * Score and prioritize discoveries
   */
  async runTriageStage(discoveries) {
    const db = await this.ensureDb();

    console.log('\n⚖️ STAGE 2: TRIAGE');
    console.log('─'.repeat(50));

    if (discoveries.length === 0) {
      console.log('  No discoveries to triage');
      return { high: [], medium: [], low: [] };
    }

    // Process in batches of 10
    const batchSize = 10;
    const allScores = [];

    for (let i = 0; i < discoveries.length; i += batchSize) {
      const batch = discoveries.slice(i, i + batchSize);
      console.log(`  Scoring batch ${Math.floor(i / batchSize) + 1}...`);

      const result = await this.triage.scoreDiscoveries(batch);
      if (result && result.scores) {
        allScores.push(...result.scores);
      }
    }

    const prioritized = {
      high: allScores.filter(s => s.priority === 'high'),
      medium: allScores.filter(s => s.priority === 'medium'),
      low: allScores.filter(s => s.priority === 'low')
    };

    console.log(`\n✓ Prioritized: ${prioritized.high.length} high, ${prioritized.medium.length} medium, ${prioritized.low.length} low`);
    return prioritized;
  }

  /**
   * Stage 3: Hypothesis Generation
   * Oracle generates hypotheses from high-priority discoveries
   */
  async runHypothesisStage(prioritizedDiscoveries) {
    const db = await this.ensureDb();

    console.log('\n💡 STAGE 3: HYPOTHESIS GENERATION');
    console.log('─'.repeat(50));

    const highPriority = prioritizedDiscoveries.high || [];
    if (highPriority.length === 0) {
      console.log('  No high-priority discoveries for hypothesis generation');
      return [];
    }

    const allHypotheses = [];

    for (const scored of highPriority) {
      // Get full discovery data
      const discovery = db.get('SELECT * FROM discoveries WHERE id = ?', [scored.discovery_id]);
      if (!discovery) continue;

      const parsedDiscovery = db.parseDiscovery(discovery);
      console.log(`  Processing: ${parsedDiscovery.title.substring(0, 50)}...`);

      const hypotheses = await this.oracle.generateHypotheses(parsedDiscovery);
      allHypotheses.push(...hypotheses);

      // Mark discovery as processed
      db.markDiscoveryProcessed(scored.discovery_id);
    }

    console.log(`\n✓ Generated ${allHypotheses.length} hypotheses`);
    return allHypotheses;
  }

  /**
   * Stage 4: Validation
   * Sage validates hypotheses against literature
   */
  async runValidationStage(hypotheses) {
    const db = await this.ensureDb();

    console.log('\n🔬 STAGE 4: VALIDATION');
    console.log('─'.repeat(50));

    if (hypotheses.length === 0) {
      console.log('  No hypotheses to validate');
      return [];
    }

    const validations = [];

    for (const hypothesis of hypotheses) {
      console.log(`  Validating: ${hypothesis.title}...`);
      const validation = await this.sage.validateHypothesis(hypothesis);
      if (validation) {
        validations.push({ hypothesis, validation });
      }
    }

    const pursued = validations.filter(v => v.validation.recommendation === 'pursue');
    console.log(`\n✓ Validated ${validations.length} hypotheses, ${pursued.length} recommended for pursuit`);
    return validations;
  }

  /**
   * Stage 5: Project Design
   * Architect designs projects for validated hypotheses
   */
  async runProjectDesignStage(validations) {
    const db = await this.ensureDb();

    console.log('\n🏗️ STAGE 5: PROJECT DESIGN');
    console.log('─'.repeat(50));

    const pursuable = validations.filter(v =>
      v.validation.recommendation === 'pursue' ||
      v.validation.recommendation === 'modify'
    );

    if (pursuable.length === 0) {
      console.log('  No validated hypotheses ready for project design');
      return [];
    }

    const projects = [];

    for (const { hypothesis, validation } of pursuable) {
      console.log(`  Designing project for: ${hypothesis.title}...`);
      const project = await this.architect.designProject(hypothesis, validation);
      if (project) {
        projects.push({ hypothesis, validation, project });
      }
    }

    console.log(`\n✓ Designed ${projects.length} projects`);
    return projects;
  }

  /**
   * Stage 6: Red Team Review
   * Adversary critically reviews projects
   */
  async runReviewStage(projectData) {
    const db = await this.ensureDb();

    console.log('\n🔴 STAGE 6: RED TEAM REVIEW');
    console.log('─'.repeat(50));

    if (projectData.length === 0) {
      console.log('  No projects to review');
      return [];
    }

    const reviews = [];

    for (const { hypothesis, project } of projectData) {
      console.log(`  Reviewing: ${project.title}...`);
      const review = await this.adversary.reviewProject(project, hypothesis);
      if (review) {
        reviews.push({ hypothesis, project, review });
      }
    }

    const approved = reviews.filter(r => r.review.overall_assessment === 'proceed');
    console.log(`\n✓ Reviewed ${reviews.length} projects, ${approved.length} approved to proceed`);
    return reviews;
  }

  /**
   * Run full pipeline
   */
  async runFullPipeline(options = {}) {
    const db = await this.ensureDb();
    const startTime = Date.now();

    console.log('\n' + '═'.repeat(60));
    console.log('🚀 STARTING FULL RESEARCH PIPELINE');
    console.log('═'.repeat(60));

    try {
      // Stage 1: Discovery
      const discoveries = await this.runDiscoveryStage(options);

      // Stage 2: Triage
      const prioritized = await this.runTriageStage(discoveries);

      // Stage 3: Hypothesis Generation
      const hypotheses = await this.runHypothesisStage(prioritized);

      // Stage 4: Validation
      const validations = await this.runValidationStage(hypotheses);

      // Stage 5: Project Design
      const projects = await this.runProjectDesignStage(validations);

      // Stage 6: Red Team Review
      const reviews = await this.runReviewStage(projects);

      const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

      console.log('\n' + '═'.repeat(60));
      console.log('✅ PIPELINE COMPLETE');
      console.log('═'.repeat(60));
      console.log(`Duration: ${duration} minutes`);
      console.log(`Discoveries: ${discoveries.length}`);
      console.log(`Hypotheses: ${hypotheses.length}`);
      console.log(`Validated: ${validations.length}`);
      console.log(`Projects: ${projects.length}`);
      console.log(`Reviews: ${reviews.length}`);

      // Generate report
      const report = this.generateReport({
        discoveries,
        prioritized,
        hypotheses,
        validations,
        projects,
        reviews,
        duration
      });

      return {
        success: true,
        discoveries,
        prioritized,
        hypotheses,
        validations,
        projects,
        reviews,
        report
      };
    } catch (error) {
      console.error('\n❌ Pipeline error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate markdown report
   */
  generateReport(data) {
    const timestamp = new Date().toISOString().split('T')[0];
    const report = `# Research Pipeline Report
Generated: ${new Date().toISOString()}
Duration: ${data.duration} minutes

## Summary
- **Discoveries scanned**: ${data.discoveries.length}
- **High priority**: ${data.prioritized.high?.length || 0}
- **Hypotheses generated**: ${data.hypotheses.length}
- **Validations completed**: ${data.validations.length}
- **Projects designed**: ${data.projects.length}
- **Reviews completed**: ${data.reviews.length}

## High Priority Discoveries
${(data.prioritized.high || []).map(d => `- **${d.discovery_id}**: Score ${d.total} - ${d.reasoning}`).join('\n') || 'None'}

## Generated Hypotheses
${data.hypotheses.map(h => `
### ${h.title}
- **Statement**: ${h.statement}
- **Confidence**: ${h.confidence_score}
- **Impact**: ${h.potential_impact || 'Not specified'}
`).join('\n') || 'None'}

## Validated Hypotheses
${data.validations.map(v => `
### ${v.hypothesis.title}
- **Confidence Level**: ${v.validation.confidence_level}
- **Recommendation**: ${v.validation.recommendation}
- **Summary**: ${v.validation.summary}
`).join('\n') || 'None'}

## Designed Projects
${data.projects.map(p => `
### ${p.project.title}
- **Objective**: ${p.project.objective}
- **Output Type**: ${p.project.output_type}
- **Timeline**: ${p.project.timeline_weeks} weeks
- **Budget**: $${p.project.estimated_cost_usd}
`).join('\n') || 'None'}

## Red Team Reviews
${data.reviews.map(r => `
### ${r.project.title}
- **Assessment**: ${r.review.overall_assessment}
- **Critical Questions**: ${(r.review.critical_questions || []).join('; ')}
- **Key Risks**: ${(r.review.risks || []).map(risk => risk.risk).join('; ')}
`).join('\n') || 'None'}

---
*Generated by Research Agent System*
`;

    // Save report
    const reportsDir = join(process.env.WORKSPACE_ROOT || '.', 'data', 'reports');
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = join(reportsDir, `pipeline-${timestamp}.md`);
    writeFileSync(reportPath, report);

    console.log(`\n📄 Report saved to: ${reportPath}`);
    return report;
  }
}

export default PipelineOrchestrator;
