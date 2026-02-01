#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'readline';
import { getAgent } from './agents/index.js';
import PipelineOrchestrator from './pipeline/orchestrator.js';
import { getDatabase } from './db/database.js';

// Load environment
config({ path: new URL('../.env', import.meta.url).pathname });

const program = new Command();

program
  .name('research')
  .description('Autonomous Research Agent System')
  .version('1.0.0');

// Scout command - search for research
program
  .command('scout')
  .description('Search for new research discoveries')
  .option('-q, --query <query>', 'Custom search query')
  .option('-d, --days <days>', 'Days back to search', '7')
  .option('-s, --source <source>', 'Source: pubmed, semantic_scholar, clinical_trials', 'all')
  .action(async (options) => {
    const spinner = ora('Initializing Scout agent...').start();

    try {
      const scout = getAgent('scout');

      if (options.query) {
        spinner.text = `Searching for: "${options.query}"`;
        const sources = options.source === 'all'
          ? ['pubmed', 'semantic_scholar', 'clinical_trials']
          : [options.source];

        const { results, errors } = await scout.searchQuery(options.query, { sources });

        spinner.succeed(`Found ${results.length} results`);

        if (errors.length > 0) {
          console.log(chalk.yellow('\nWarnings:'));
          errors.forEach(e => console.log(`  ${e.source}: ${e.error}`));
        }

        console.log(chalk.bold('\nTop Results:'));
        results.slice(0, 10).forEach((r, i) => {
          console.log(`\n${chalk.cyan(`[${i + 1}]`)} ${r.title}`);
          console.log(`    ${chalk.gray(r.source)} | ${r.publication_date || 'Date unknown'}`);
          if (r.abstract) {
            console.log(`    ${r.abstract.substring(0, 150)}...`);
          }
        });
      } else {
        spinner.text = 'Running daily domain scan...';
        const results = await scout.dailyScan();

        spinner.succeed('Daily scan complete');

        console.log(chalk.bold('\nResults by Domain:'));
        results.forEach(r => {
          console.log(`\n${chalk.cyan(r.domain)}: ${r.count} items`);
          r.results.slice(0, 3).forEach(item => {
            console.log(`  - ${item.title.substring(0, 60)}...`);
          });
        });
      }
    } catch (error) {
      spinner.fail(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Pipeline command - run full or partial pipeline
program
  .command('pipeline')
  .description('Run the research pipeline')
  .option('-f, --full', 'Run full pipeline')
  .option('-q, --query <query>', 'Start with custom query')
  .option('-s, --stage <stage>', 'Run specific stage: discovery, triage, hypothesis, validation, project, review')
  .action(async (options) => {
    const spinner = ora('Initializing pipeline...').start();

    try {
      const orchestrator = new PipelineOrchestrator();

      if (options.full || options.query) {
        spinner.stop();
        await orchestrator.runFullPipeline({ query: options.query });
      } else if (options.stage) {
        spinner.text = `Running ${options.stage} stage...`;
        const db = await getDatabase();

        switch (options.stage) {
          case 'discovery':
            spinner.stop();
            await orchestrator.runDiscoveryStage();
            break;
          case 'triage':
            const discoveries = db.getUnprocessedDiscoveries(50);
            spinner.stop();
            await orchestrator.runTriageStage(discoveries);
            break;
          case 'hypothesis':
            const highPriority = db.getDiscoveriesByPriority('high', 10);
            spinner.stop();
            await orchestrator.runHypothesisStage({ high: highPriority.map(d => ({ discovery_id: d.id })) });
            break;
          case 'validation':
            const hypotheses = db.getHypothesesByStatus('generated', 10);
            spinner.stop();
            await orchestrator.runValidationStage(hypotheses);
            break;
          default:
            spinner.fail(`Unknown stage: ${options.stage}`);
        }
      } else {
        spinner.info('Specify --full for full pipeline or --stage for specific stage');
      }
    } catch (error) {
      spinner.fail(`Error: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  });

// Chat command - interactive chat with agents
program
  .command('chat')
  .description('Interactive chat with an agent')
  .option('-a, --agent <agent>', 'Agent to chat with: scout, triage, oracle, sage, architect, adversary', 'oracle')
  .action(async (options) => {
    console.log(chalk.bold(`\n💬 Chat with ${options.agent.toUpperCase()} agent`));
    console.log(chalk.gray('Type "exit" to quit, "clear" to reset context\n'));

    const agent = getAgent(options.agent);
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const prompt = () => {
      rl.question(chalk.cyan('You: '), async (input) => {
        const trimmed = input.trim();

        if (trimmed.toLowerCase() === 'exit') {
          console.log(chalk.gray('\nGoodbye!'));
          rl.close();
          return;
        }

        if (trimmed.toLowerCase() === 'clear') {
          agent.clearHistory();
          console.log(chalk.gray('Context cleared.\n'));
          prompt();
          return;
        }

        if (!trimmed) {
          prompt();
          return;
        }

        const spinner = ora('Thinking...').start();

        try {
          const response = await agent.chat(trimmed);
          spinner.stop();
          console.log(chalk.green(`\n${options.agent}: `) + response + '\n');
        } catch (error) {
          spinner.fail(`Error: ${error.message}`);
        }

        prompt();
      });
    };

    prompt();
  });

// Report command - view system status and reports
program
  .command('report')
  .description('View system status and generate reports')
  .option('-s, --stats', 'Show database statistics')
  .option('-a, --activity', 'Show recent activity')
  .option('-p, --projects', 'List all projects')
  .option('-h, --hypotheses', 'List all hypotheses')
  .action(async (options) => {
    try {
      const db = await getDatabase();

      if (options.stats) {
        const stats = db.getStats();
        console.log(chalk.bold('\n📊 Database Statistics'));
        console.log('─'.repeat(40));
        console.log(`Discoveries: ${stats.discoveries} (${stats.unprocessed} unprocessed)`);
        console.log(`Hypotheses: ${stats.hypotheses}`);
        console.log(`Validations: ${stats.validations}`);
        console.log(`Projects: ${stats.projects}`);
        console.log(`Reviews: ${stats.reviews}`);
      }

      if (options.activity) {
        const activity = db.getRecentActivity(20);
        console.log(chalk.bold('\n📜 Recent Activity'));
        console.log('─'.repeat(40));
        activity.forEach(a => {
          console.log(`${chalk.gray(a.created_at)} ${chalk.cyan(a.agent)}: ${a.action} - ${a.summary || ''}`);
        });
      }

      if (options.projects) {
        console.log(chalk.bold('\n🏗️ Projects'));
        console.log('─'.repeat(40));
        for (const status of ['drafted', 'approved', 'revision_needed', 'rejected']) {
          const projects = db.getProjectsByStatus(status, 10);
          if (projects.length > 0) {
            console.log(chalk.yellow(`\n${status.toUpperCase()}:`));
            projects.forEach(p => {
              console.log(`  - ${p.title}`);
              console.log(`    ${chalk.gray(`${p.output_type} | ${p.timeline_weeks} weeks | $${p.estimated_cost_usd}`)}`);
            });
          }
        }
      }

      if (options.hypotheses) {
        console.log(chalk.bold('\n💡 Hypotheses'));
        console.log('─'.repeat(40));
        for (const status of ['generated', 'validating', 'validated', 'rejected', 'project']) {
          const hypotheses = db.getHypothesesByStatus(status, 10);
          if (hypotheses.length > 0) {
            console.log(chalk.yellow(`\n${status.toUpperCase()}:`));
            hypotheses.forEach(h => {
              console.log(`  - ${h.title}`);
              console.log(`    ${chalk.gray(`Confidence: ${h.confidence_score}`)}`);
            });
          }
        }
      }

      if (!options.stats && !options.activity && !options.projects && !options.hypotheses) {
        // Show summary by default
        const stats = db.getStats();
        console.log(chalk.bold('\n📊 Research Agent System Status'));
        console.log('═'.repeat(50));
        console.log(`\nDiscoveries: ${chalk.cyan(stats.discoveries)} (${stats.unprocessed} pending)`);
        console.log(`Hypotheses:  ${chalk.cyan(stats.hypotheses)}`);
        console.log(`Validations: ${chalk.cyan(stats.validations)}`);
        console.log(`Projects:    ${chalk.cyan(stats.projects)}`);
        console.log(`Reviews:     ${chalk.cyan(stats.reviews)}`);
        console.log('\nUse --stats, --activity, --projects, or --hypotheses for details');
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Domain command - manage research domains
program
  .command('domains')
  .description('List and manage research domains')
  .action(async () => {
    try {
      const db = await getDatabase();
      const domains = db.getActiveDomains();

      console.log(chalk.bold('\n🎯 Active Research Domains'));
      console.log('─'.repeat(50));

      domains.forEach(d => {
        console.log(`\n${chalk.cyan(d.name)}`);
        console.log(`  Keywords: ${d.keywords.join(', ')}`);
        console.log(`  MeSH Terms: ${d.mesh_terms.join(', ')}`);
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Feedback command - rate and comment on items
program
  .command('feedback')
  .description('Add feedback on hypotheses, discoveries, or projects')
  .option('-t, --type <type>', 'Entity type: hypothesis, discovery, project', 'hypothesis')
  .option('-i, --id <id>', 'Entity ID to rate')
  .option('-r, --rating <rating>', 'Rating: 1-5 or thumbs (up/down)')
  .option('-n, --notes <notes>', 'Add notes/comments')
  .option('-l, --list', 'List recent feedback')
  .action(async (options) => {
    try {
      const db = await getDatabase();

      if (options.list) {
        const feedback = db.getAllFeedback(null, 20);
        console.log(chalk.bold('\n📝 Recent Feedback'));
        console.log('─'.repeat(50));

        if (feedback.length === 0) {
          console.log(chalk.gray('No feedback recorded yet.'));
        } else {
          feedback.forEach(f => {
            const rating = f.rating ? `★${f.rating}` : (f.useful ? '👍' : '👎');
            console.log(`\n${chalk.cyan(f.entity_type)} ${f.entity_id.substring(0, 8)}...`);
            console.log(`  Rating: ${rating}`);
            if (f.notes) console.log(`  Notes: ${f.notes}`);
            console.log(`  ${chalk.gray(f.updated_at)}`);
          });
        }
        return;
      }

      if (!options.id) {
        // Interactive mode - show recent items to rate
        console.log(chalk.bold(`\nRecent ${options.type}s to rate:`));
        console.log('─'.repeat(50));

        let items = [];
        if (options.type === 'hypothesis') {
          items = db.getHypothesesByStatus('generated', 5)
            .concat(db.getHypothesesByStatus('validated', 5));
        } else if (options.type === 'discovery') {
          items = db.getUnprocessedDiscoveries(10);
        }

        items.forEach((item, i) => {
          const existing = db.getFeedback(options.type, item.id);
          const rated = existing ? chalk.green(' ✓') : '';
          console.log(`${chalk.cyan(`[${i + 1}]`)} ${item.title.substring(0, 60)}...${rated}`);
          console.log(`    ID: ${item.id}`);
        });

        console.log(chalk.gray('\nUse: feedback -t hypothesis -i <ID> -r 5 -n "Great insight!"'));
        return;
      }

      // Add feedback
      const rating = options.rating === 'up' ? null : (options.rating === 'down' ? null : parseInt(options.rating));
      const useful = options.rating === 'up' ? true : (options.rating === 'down' ? false : rating >= 3);

      db.addFeedback(options.type, options.id, {
        rating,
        useful,
        notes: options.notes
      });

      // Learn from feedback
      if (useful && options.type === 'hypothesis') {
        const hypothesis = db.get('SELECT * FROM hypotheses WHERE id = ?', [options.id]);
        if (hypothesis) {
          // Extract keywords from title for preference learning
          const words = hypothesis.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          for (const word of words.slice(0, 3)) {
            db.addPreference({
              preference_type: 'topic_interest',
              value: word,
              weight: 0.2,
              learned_from: [options.id]
            });
          }
        }
      }

      console.log(chalk.green(`\n✓ Feedback saved for ${options.type} ${options.id.substring(0, 8)}...`));

    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Memory command - add and view your own insights
program
  .command('memory')
  .description('Manage your research memory and insights')
  .option('-a, --add', 'Add a new memory entry')
  .option('-c, --category <category>', 'Category: insight, preference, context, competitor, strategy', 'insight')
  .option('-t, --title <title>', 'Title for the memory')
  .option('-m, --message <message>', 'Content of the memory')
  .option('-i, --importance <level>', 'Importance: critical, high, normal, low', 'normal')
  .option('-l, --list', 'List all memories')
  .option('-s, --search <query>', 'Search memories')
  .action(async (options) => {
    try {
      const db = await getDatabase();

      if (options.search) {
        const results = db.searchMemory(options.search);
        console.log(chalk.bold(`\n🔍 Memory Search: "${options.search}"`));
        console.log('─'.repeat(50));

        if (results.length === 0) {
          console.log(chalk.gray('No matching memories found.'));
        } else {
          results.forEach(m => {
            const icon = m.importance === 'critical' ? '🔴' : m.importance === 'high' ? '🟠' : '⚪';
            console.log(`\n${icon} ${chalk.cyan(m.title)}`);
            console.log(`   ${chalk.gray(m.category)} | ${m.created_at}`);
            console.log(`   ${m.content.substring(0, 150)}...`);
          });
        }
        return;
      }

      if (options.list) {
        const memories = db.getAllMemory();
        console.log(chalk.bold('\n🧠 Research Memory'));
        console.log('─'.repeat(50));

        if (memories.length === 0) {
          console.log(chalk.gray('No memories recorded yet.'));
          console.log(chalk.gray('\nAdd one: memory -a -t "Title" -m "Your insight here"'));
        } else {
          const byCategory = {};
          memories.forEach(m => {
            if (!byCategory[m.category]) byCategory[m.category] = [];
            byCategory[m.category].push(m);
          });

          for (const [cat, items] of Object.entries(byCategory)) {
            console.log(chalk.yellow(`\n${cat.toUpperCase()}:`));
            items.forEach(m => {
              const icon = m.importance === 'critical' ? '🔴' : m.importance === 'high' ? '🟠' : '⚪';
              console.log(`  ${icon} ${m.title}`);
              console.log(`     ${chalk.gray(m.content.substring(0, 80))}...`);
            });
          }
        }
        return;
      }

      if (options.add || (options.title && options.message)) {
        if (!options.title || !options.message) {
          console.log(chalk.red('Error: Both --title and --message are required'));
          console.log(chalk.gray('Example: memory -a -t "Key insight" -m "GLP-1 muscle loss is reversible"'));
          return;
        }

        const id = db.addMemory({
          category: options.category,
          title: options.title,
          content: options.message,
          importance: options.importance,
          keywords: options.title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        });

        console.log(chalk.green(`\n✓ Memory saved: ${options.title}`));
        console.log(chalk.gray(`  ID: ${id}`));
        console.log(chalk.gray(`  Category: ${options.category}`));
        console.log(chalk.gray(`  Importance: ${options.importance}`));
        return;
      }

      // Default: show summary
      const memories = db.getAllMemory();
      const stats = {
        total: memories.length,
        critical: memories.filter(m => m.importance === 'critical').length,
        high: memories.filter(m => m.importance === 'high').length
      };

      console.log(chalk.bold('\n🧠 Memory Status'));
      console.log('─'.repeat(50));
      console.log(`Total entries: ${stats.total}`);
      console.log(`Critical: ${stats.critical} | High: ${stats.high}`);
      console.log(chalk.gray('\nCommands:'));
      console.log('  memory --list              View all memories');
      console.log('  memory --search <query>    Search memories');
      console.log('  memory -a -t "Title" -m "Content"   Add new memory');

    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Schedule command - view today's scan
program
  .command('schedule')
  .description('View the daily scan schedule')
  .action(async () => {
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');

      const schedulePath = join(process.env.WORKSPACE_ROOT || '.', 'config', 'schedule.json');
      const schedule = JSON.parse(readFileSync(schedulePath, 'utf-8'));

      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const today = days[new Date().getDay()];

      console.log(chalk.bold('\n📅 Weekly Scan Schedule'));
      console.log('─'.repeat(50));

      for (const day of days) {
        const config = schedule.rotation[day];
        const isToday = day === today;
        const marker = isToday ? chalk.green(' ← TODAY') : '';
        const dayLabel = isToday ? chalk.cyan(day.toUpperCase()) : day;

        console.log(`${dayLabel}: ${config.name}${marker}`);
      }

      console.log(chalk.gray(`\nSettings: ${schedule.settings.daysBack} days back, runs at ${schedule.settings.runTime}`));

    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();
