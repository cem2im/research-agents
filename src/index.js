import { config } from 'dotenv';
import PipelineOrchestrator from './pipeline/orchestrator.js';
import { getDatabase } from './db/database.js';

// Load environment
config();

async function main() {
  console.log('🔬 Research Agent System');
  console.log('========================\n');

  // Initialize database
  const db = await getDatabase();
  const stats = db.getStats();

  console.log('Database Status:');
  console.log(`  Discoveries: ${stats.discoveries}`);
  console.log(`  Hypotheses: ${stats.hypotheses}`);
  console.log(`  Projects: ${stats.projects}`);
  console.log('');

  // Run pipeline if started without arguments
  if (process.argv.length === 2) {
    console.log('Starting daily research scan...\n');
    const orchestrator = new PipelineOrchestrator();
    await orchestrator.runFullPipeline({ daysBack: 7 });
  }
}

main().catch(console.error);
