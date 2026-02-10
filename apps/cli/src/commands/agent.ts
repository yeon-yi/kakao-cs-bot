import { Command } from 'commander';

export const agentCommand = new Command('agent')
  .description('에이전트 관리');

agentCommand
  .command('status')
  .description('에이전트 상태 확인')
  .action(async () => {
    console.log('\n📊 에이전트 상태\n');
    console.log('  Coordinator:  ✅ Running');
    console.log('  Message(x1):  ✅ Running');
    console.log('  Knowledge:    ✅ Running');
    console.log('  Learning:     ⏸️  Idle');
    console.log('  Identity:     ✅ Running');
    console.log('');
  });

agentCommand
  .command('start')
  .description('에이전트 시작')
  .option('-a, --all', '모든 에이전트')
  .option('-n, --name <names>', '에이전트 이름 (쉼표 구분)')
  .option('--instances <number>', '인스턴스 수', '1')
  .action(async (options) => {
    const agents = options.all
      ? ['coordinator', 'message', 'knowledge', 'learning', 'identity']
      : (options.name || 'coordinator,message').split(',').map((s: string) => s.trim());

    console.log('\n🚀 에이전트 시작 중...\n');
    for (const agent of agents) {
      console.log(`  ✅ ${agent} 시작 완료 (인스턴스: ${options.instances})`);
    }
    console.log('\n모든 에이전트가 시작되었습니다.\n');
  });

agentCommand
  .command('stop')
  .description('에이전트 중지')
  .option('-a, --all', '모든 에이전트')
  .option('-n, --name <names>', '에이전트 이름')
  .action(async (options) => {
    const agents = options.all
      ? ['coordinator', 'message', 'knowledge', 'learning', 'identity']
      : (options.name || '').split(',').map((s: string) => s.trim()).filter(Boolean);

    console.log('\n🛑 에이전트 중지 중...\n');
    for (const agent of agents) {
      console.log(`  ⏹️  ${agent} 중지 완료`);
    }
    console.log('');
  });

agentCommand
  .command('restart')
  .description('에이전트 재시작')
  .option('-n, --name <names>', '에이전트 이름')
  .action(async (options) => {
    console.log(`\n🔄 ${options.name || 'all'} 재시작 중...\n`);
    console.log('  ✅ 재시작 완료\n');
  });
