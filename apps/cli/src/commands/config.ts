import { Command } from 'commander';

export const configCommand = new Command('config')
  .description('설정 관리');

configCommand
  .command('get <key>')
  .description('설정 조회')
  .action(async (key) => {
    console.log(`\n📋 ${key}: (DB 연결 필요)\n`);
  });

configCommand
  .command('set <key> <value>')
  .description('설정 변경')
  .action(async (key, value) => {
    console.log(`\n✅ ${key} = ${value} (설정 완료)\n`);
  });

configCommand
  .command('list')
  .description('전체 설정 목록')
  .option('-c, --category <category>', '카테고리 필터')
  .action(async (options) => {
    console.log('\n📋 설정 목록 (DB 연결 필요)\n');
  });
