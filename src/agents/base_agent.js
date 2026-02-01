import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDatabase } from '../db/database.js';
import { getVectorStore } from '../memory/vector_store.js';

class BaseAgent {
  constructor(agentId, config = {}) {
    this.agentId = agentId;
    this.name = config.name || agentId;
    this.role = config.role || 'Research Agent';
    this.model = config.model || process.env.MODEL_DEFAULT || 'claude-sonnet-4-20250514';

    // Explicitly pass API key from environment
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ ANTHROPIC_API_KEY not found in environment');
    }
    this.anthropic = new Anthropic({ apiKey });
    this.db = null;
    this.vectorStore = getVectorStore();

    this.soulPath = join(process.env.WORKSPACE_ROOT || '.', 'config', 'souls', `${agentId}.md`);
    this.soul = this.loadSoul();

    this.conversationHistory = [];
  }

  async ensureDb() {
    if (!this.db) {
      this.db = await getDatabase();
    }
    return this.db;
  }

  loadSoul() {
    if (existsSync(this.soulPath)) {
      return readFileSync(this.soulPath, 'utf-8');
    }
    return `You are ${this.name}, a ${this.role}.`;
  }

  async buildSystemPrompt(context = {}) {
    const basePrompt = this.soul;

    // Add current context
    const contextSection = context.additionalContext
      ? `\n\n## Current Context\n${context.additionalContext}`
      : '';

    // Add relevant memory from vector store
    let memorySection = '';
    if (context.query) {
      try {
        const relevantMemory = await this.vectorStore.search(context.query, { limit: 5 });
        if (relevantMemory.length > 0) {
          memorySection = '\n\n## Relevant Memory\n' + relevantMemory
            .map(m => `[${m.metadata.type}] ${m.content.substring(0, 500)}...`)
            .join('\n\n');
        }
      } catch (e) {
        // Vector store might not be initialized
      }
    }

    return `${basePrompt}${contextSection}${memorySection}

## Output Format
Respond in a structured format when appropriate. Use JSON for data, markdown for reports.
Always be specific with sources, confidence levels, and reasoning.

Current timestamp: ${new Date().toISOString()}`;
  }

  async chat(userMessage, context = {}) {
    const systemPrompt = await this.buildSystemPrompt({
      ...context,
      query: userMessage
    });

    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: this.conversationHistory
    });

    const assistantMessage = response.content[0].text;

    this.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage
    });

    // Log activity
    const db = await this.ensureDb();
    db.logActivity(
      this.agentId,
      'chat',
      null,
      null,
      userMessage.substring(0, 100)
    );

    return assistantMessage;
  }

  async process(input, context = {}) {
    // Override in subclasses for specific processing logic
    return this.chat(input, context);
  }

  // Parse structured JSON from response
  parseJsonResponse(response) {
    try {
      // Try to find JSON block
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // Try to parse entire response as JSON
      return JSON.parse(response);
    } catch (e) {
      return null;
    }
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

export default BaseAgent;
