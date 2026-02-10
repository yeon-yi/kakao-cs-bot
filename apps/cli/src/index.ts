#!/usr/bin/env node
import { Command } from 'commander';
import { agentCommand } from './commands/agent';
import { knowledgeCommand } from './commands/knowledge';
import { configCommand } from './commands/config';
import { analyticsCommand } from './commands/analytics';
import { dbCommand } from './commands/db';

const program = new Command();

program
  .name('cs-bot')
  .description('KakaoTalk CS Bot CLI')
  .version('1.0.0');

program.addCommand(agentCommand);
program.addCommand(knowledgeCommand);
program.addCommand(configCommand);
program.addCommand(analyticsCommand);
program.addCommand(dbCommand);

program
  .command('validate-env')
  .description('환경변수 검증')
  .action(async () => {
    const { loadEnv, maskSensitive } = await import('@kakao-cs-bot/config');
    const env = loadEnv();
    const masked = maskSensitive(env);
    console.log('\n✅ 환경변수 검증 완료\n');
    for (const [key, value] of Object.entries(masked)) {
      console.log(`  ${key}: ${value}`);
    }
  });

program.parse();
