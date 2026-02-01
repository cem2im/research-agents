import ScoutAgent from './scout.js';
import TriageAgent from './triage.js';
import OracleAgent from './oracle.js';
import SageAgent from './sage.js';
import ArchitectAgent from './architect.js';
import AdversaryAgent from './adversary.js';

// Agent registry
const agents = {
  scout: null,
  triage: null,
  oracle: null,
  sage: null,
  architect: null,
  adversary: null
};

export function getAgent(agentId) {
  if (!agents[agentId]) {
    switch (agentId) {
      case 'scout':
        agents[agentId] = new ScoutAgent();
        break;
      case 'triage':
        agents[agentId] = new TriageAgent();
        break;
      case 'oracle':
        agents[agentId] = new OracleAgent();
        break;
      case 'sage':
        agents[agentId] = new SageAgent();
        break;
      case 'architect':
        agents[agentId] = new ArchitectAgent();
        break;
      case 'adversary':
        agents[agentId] = new AdversaryAgent();
        break;
      default:
        throw new Error(`Unknown agent: ${agentId}`);
    }
  }
  return agents[agentId];
}

export function getAllAgents() {
  return ['scout', 'triage', 'oracle', 'sage', 'architect', 'adversary'].map(getAgent);
}

export {
  ScoutAgent,
  TriageAgent,
  OracleAgent,
  SageAgent,
  ArchitectAgent,
  AdversaryAgent
};
