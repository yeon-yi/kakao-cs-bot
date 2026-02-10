import { Command } from 'commander';

export const dbCommand = new Command('db')
  .description('데이터베이스 관리');

dbCommand
  .command('migrate')
  .description('마이그레이션 실행')
  .action(async () => {
    console.log('\n🔄 마이그레이션 실행 중...');
    console.log('  infra/schema.sql 파일을 Supabase SQL Editor에서 실행하세요.\n');
  });

dbCommand
  .command('seed')
  .description('시드 데이터 삽입')
  .action(async () => {
    console.log('\n🌱 시드 데이터 삽입 중...');
    console.log('  infra/schema.sql의 INSERT 구문을 참조하세요.\n');
  });

dbCommand
  .command('backup')
  .description('데이터베이스 백업')
  .action(async () => {
    console.log('\n💾 백업 시작...');
    console.log('  Supabase Dashboard에서 백업을 관리할 수 있습니다.\n');
  });
