export { getPool, query, queryOne, queryCount } from './client';
export type { Database } from './types';
export { KnowledgeRepository } from './repositories/knowledge';
export { ConversationRepository } from './repositories/conversations';
export { IdentityRepository } from './repositories/identity';
export { ConfigRepository, PromptRepository, AnalyticsRepository } from './repositories/config';
export { EscalationRepository } from './repositories/escalation';
export { ProactiveRepository } from './repositories/proactive';
export { UncertaintyRepository } from './repositories/uncertainty';
