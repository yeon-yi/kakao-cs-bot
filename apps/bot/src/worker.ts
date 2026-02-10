import { loadEnv, createLogger } from '@kakao-cs-bot/config';
import { CoordinatorAgent } from './agents/coordinator';
import { MessageAgent } from './agents/message-agent';

const env = loadEnv();
const logger = createLogger('bot:worker');

async function main() {
  logger.info('Bot worker starting...');

  // Start coordinator
  const coordinator = new CoordinatorAgent();
  await coordinator.start();

  // Start message agents (configurable count)
  const agentCount = parseInt(process.env.MESSAGE_AGENT_COUNT || '1');
  const messageAgents: MessageAgent[] = [];

  for (let i = 0; i < agentCount; i++) {
    const agent = new MessageAgent(`message-${i}`);
    await agent.start();
    messageAgents.push(agent);
  }

  logger.info(`Bot worker started with ${agentCount} message agent(s)`);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    for (const agent of messageAgents) {
      await agent.stop();
    }
    await coordinator.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Worker failed to start', { error: String(error) });
  process.exit(1);
});
