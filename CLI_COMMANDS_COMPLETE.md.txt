# CLI 명령어 완전 가이드

## 설치
```bash
# 전역 설치
npm install -g @kakao-cs-bot/cli

# 또는 로컬에서 실행
cd kakao-cs-bot
npm run cli -- [command]

# Alias 설정
echo "alias cs-bot='npm run cli --'" >> ~/.zshrc
source ~/.zshrc
```

## 명령어 체계
```
cs-bot
├── validate-env              # 환경변수 검증
├── agent                      # 에이전트 관리
│   ├── start                  # 시작
│   ├── stop                   # 중지
│   ├── restart                # 재시작
│   ├── status                 # 상태
│   ├── logs                   # 로그
│   └── scale                  # 스케일링
├── knowledge                  # 지식 관리
│   ├── add                    # 추가
│   ├── update                 # 수정
│   ├── delete                 # 삭제
│   ├── search                 # 검색
│   ├── import                 # 일괄 가져오기
│   ├── export                 # 내보내기
│   └── stats                  # 통계
├── deploy                     # 배포
│   ├── build                  # 빌드
│   ├── push                   # 푸시 및 배포
│   ├── rollback               # 롤백
│   └── status                 # 배포 상태
├── db                         # DB 관리
│   ├── migrate                # 마이그레이션
│   ├── seed                   # 시드
│   ├── backup                 # 백업
│   ├── restore                # 복원
│   └── reset                  # 리셋
├── config                     # 설정
│   ├── get                    # 조회
│   ├── set                    # 변경
│   ├── list                   # 목록
│   └── reset                  # 초기화
├── prompt                     # 프롬프트
│   ├── get                    # 조회
│   ├── update                 # 수정
│   ├── list                   # 목록
│   ├── test                   # 테스트
│   └── revert                 # 되돌리기
├── analytics                  # 분석
│   ├── daily                  # 일일 통계
│   ├── cost                   # 비용 분석
│   ├── accuracy               # 정확도
│   └── export                 # 리포트 내보내기
└── dev                        # 개발
    ├── start                  # 개발 서버
    ├── test                   # 테스트
    └── reset                  # DB 리셋
```

## 명령어 상세

### 1. validate-env
```bash
# 환경변수 검증
cs-bot validate-env

# 출력 예시:
# ✅ 환경변수 검증 완료
#   SUPABASE_URL: https://xxxxx.supabase.co
#   REDIS_URL: rediss://xxxxx.upstash.io:6379
#   GEMINI_API_KEY: AIza...
```

**옵션**:
```bash
--verbose     # 상세 정보
--json        # JSON 출력
```

### 2. agent

#### start
```bash
# 모든 에이전트 시작
cs-bot agent start --all

# 특정 에이전트만
cs-bot agent start --name coordinator
cs-bot agent start --name message

# 복수 지정
cs-bot agent start --name coordinator,message,knowledge
```

**옵션**:
```bash
-a, --all                    # 모든 에이전트
-n, --name <names>           # 에이전트 이름 (쉼표 구분)
--instances <number>         # 인스턴스 수
--env <environment>          # 환경 (dev, staging, prod)
```

**구현**:
```typescript
// cli/src/commands/agent/start.ts (확장)

export async function startAgent(options: StartOptions): Promise<void> {
  const spinner = ora('에이전트 시작 중...').start();
  
  try {
    // 1. 환경 확인
    const env = options.env || process.env.NODE_ENV || 'development';
    const isK8s = env === 'production';
    
    // 2. 에이전트 목록 결정
    let agents: string[] = [];
    
    if (options.all) {
      agents = ['coordinator', 'message', 'knowledge', 'learning', 'identity'];
    } else if (options.name) {
      agents = options.name.split(',').map(s => s.trim());
    } else {
      // 인터랙티브 선택
      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: '시작할 에이전트를 선택하세요',
          choices: [
            { name: 'Coordinator', value: 'coordinator', checked: true },
            { name: 'Message Agent', value: 'message', checked: true },
            { name: 'Knowledge Agent', value: 'knowledge' },
            { name: 'Learning Agent', value: 'learning' },
            { name: 'Identity Agent', value: 'identity' },
          ],
        },
      ]);
      agents = selected;
    }
    
    // 3. 시작
    for (const agent of agents) {
      if (isK8s) {
        // Kubernetes
        await execa('kubectl', [
          'scale',
          'deployment',
          `cs-bot-${agent}`,
          '--replicas',
          String(options.instances || 3),
          '-n',
          'kakao-cs-bot',
        ]);
      } else {
        // PM2
        await execa('pm2', [
          'start',
          `apps/bot/dist/agents/${agent}.js`,
          '--name',
          `cs-bot-${agent}`,
          '--instances',
          String(options.instances || 1),
        ]);
      }
      
      spinner.text = `✅ ${agent} 시작 완료`;
      await sleep(500);
    }
    
    spinner.succeed(chalk.green('모든 에이전트 시작 완료'));
    
    // 4. 상태 확인
    await statusAgent();
    
  } catch (error) {
    spinner.fail(chalk.red('에이전트 시작 실패'));
    console.error(error);
    process.exit(1);
  }
}
```

#### logs
```bash
# 실시간 로그
cs-bot agent logs --name message --follow

# 최근 100줄
cs-bot agent logs --name coordinator --lines 100

# 에러만
cs-bot agent logs --name message --level error

# JSON 포맷
cs-bot agent logs --name message --format json

# 시간 범위
cs-bot agent logs --name message --since 1h
cs-bot agent logs --name message --since "2024-01-01 10:00"
```

**옵션**:
```bash
-n, --name <name>            # 에이전트 이름
-f, --follow                 # 실시간 (tail -f)
-l, --lines <number>         # 표시할 줄 수
--level <level>              # 로그 레벨 (debug, info, warn, error)
--format <format>            # 출력 형식 (text, json)
--since <time>               # 시작 시간 (1h, 30m, YYYY-MM-DD HH:MM)
--until <time>               # 종료 시간
--grep <pattern>             # 패턴 검색
```

#### scale
```bash
# 스케일 아웃
cs-bot agent scale --name message --replicas 5

# 스케일 인
cs-bot agent scale --name message --replicas 1

# Auto-scaling 활성화
cs-bot agent scale --name message --auto --min 3 --max 10
```

### 3. knowledge

#### add
```bash
# 인터랙티브 모드
cs-bot knowledge add --interactive

# 직접 입력
cs-bot knowledge add \
  --question "정산은 언제 되나요?" \
  --answer "정산은 매월 10일에 입금됩니다." \
  --category "정산" \
  --tier 1

# 파일에서
cs-bot knowledge add --from-file knowledge.json
```

**인터랙티브 모드**:
```typescript
async function addKnowledgeInteractive(): Promise<void> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'question',
      message: '질문을 입력하세요:',
      validate: (input) => input.length >= 5 || '최소 5자 이상',
    },
    {
      type: 'editor',
      name: 'answer',
      message: '답변을 입력하세요 (에디터가 열립니다):',
    },
    {
      type: 'list',
      name: 'category',
      message: '카테고리를 선택하세요:',
      choices: ['정산', '계약', '시스템 사용', '기타'],
    },
    {
      type: 'list',
      name: 'tier',
      message: 'Tier를 선택하세요:',
      choices: [
        { name: 'Tier 1 (공식 자료)', value: 1 },
        { name: 'Tier 2 (학습된 지식)', value: 2 },
        { name: 'Tier 3 (대화 패턴)', value: 3 },
      ],
      default: 2,
    },
    {
      type: 'input',
      name: 'tags',
      message: '태그 (쉼표로 구분):',
      filter: (input) => input.split(',').map((s: string) => s.trim()),
    },
  ]);
  
  const spinner = ora('지식 추가 중...').start();
  
  try {
    const result = await trpc.knowledge.add.mutate(answers);
    spinner.succeed(chalk.green(`지식 추가 완료 (ID: ${result.id})`));
  } catch (error) {
    spinner.fail(chalk.red('지식 추가 실패'));
    console.error(error);
  }
}
```

#### import
```bash
# CSV 가져오기
cs-bot knowledge import data/knowledge.csv

# JSON 가져오기
cs-bot knowledge import data/knowledge.json

# 옵션
cs-bot knowledge import data/knowledge.csv \
  --tier 2 \
  --category "정산" \
  --dry-run  # 테스트만

# 진행 상황
cs-bot knowledge import data/large.csv --progress
```

**CSV 형식**:
```csv
question,answer,category,tags
"정산은 언제 되나요?","정산은 매월 10일에 입금됩니다.","정산","정산,입금"
"계약서는 어디서 확인하나요?","나의서비스관리 > 계약관리에서 확인하실 수 있습니다.","계약","계약서,확인"
```

**구현**:
```typescript
// cli/src/commands/knowledge/import.ts

import Papa from 'papaparse';
import { createReadStream } from 'fs';
import ProgressBar from 'progress';

export async function importKnowledge(
  file: string,
  options: ImportOptions
): Promise<void> {
  const ext = path.extname(file);
  let data: KnowledgeItem[] = [];
  
  // 파일 읽기
  if (ext === '.csv') {
    data = await parseCSV(file);
  } else if (ext === '.json') {
    data = JSON.parse(await fs.readFile(file, 'utf-8'));
  } else {
    throw new Error('지원하지 않는 파일 형식');
  }
  
  console.log(chalk.cyan(`\n총 ${data.length}개 항목 발견\n`));
  
  // Dry run
  if (options.dryRun) {
    console.log(chalk.yellow('🔍 Dry Run 모드 (실제 저장 안함)\n'));
    data.slice(0, 5).forEach((item, index) => {
      console.log(`${index + 1}. ${item.question}`);
      console.log(`   답변: ${item.answer.slice(0, 50)}...`);
      console.log(`   카테고리: ${item.category || options.category}`);
    });
    return;
  }
  
  // 프로그레스 바
  const bar = new ProgressBar('가져오는 중 [:bar] :current/:total :percent :etas', {
    total: data.length,
    width: 40,
  });
  
  // 배치 처리
  const BATCH_SIZE = 10;
  let imported = 0;
  let failed = 0;
  
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(item =>
        trpc.knowledge.add.mutate({
          ...item,
          tier: options.tier || item.tier || 2,
          category: options.category || item.category,
        })
      )
    );
    
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        imported++;
      } else {
        failed++;
      }
      bar.tick();
    });
  }
  
  console.log(chalk.green(`\n✅ 가져오기 완료`));
  console.log(`   성공: ${imported}개`);
  if (failed > 0) {
    console.log(chalk.red(`   실패: ${failed}개`));
  }
}

async function parseCSV(file: string): Promise<KnowledgeItem[]> {
  return new Promise((resolve, reject) => {
    const results: KnowledgeItem[] = [];
    
    Papa.parse(createReadStream(file), {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        resolve(result.data as KnowledgeItem[]);
      },
      error: reject,
    });
  });
}
```

### 4. deploy

#### build
```bash
# 모든 앱 빌드
cs-bot deploy build

# 특정 앱만
cs-bot deploy build --app api
cs-bot deploy build --app bot

# 캐시 없이
cs-bot deploy build --no-cache

# 태그 지정
cs-bot deploy build --tag v1.2.3
```

#### push
```bash
# Staging 배포
cs-bot deploy push --env staging

# Production 배포
cs-bot deploy push --env production --app api

# 테스트 스킵
cs-bot deploy push --env production --skip-tests

# 승인 필요
cs-bot deploy push --env production --require-approval
```

**구현**:
```typescript
// cli/src/commands/deploy/push.ts

export async function deployCommand(options: DeployOptions): Promise<void> {
  console.log(chalk.cyan.bold(`\n🚀 배포 시작: ${options.env}\n`));
  
  // 1. Pre-flight checks
  const spinner = ora('사전 검사 중...').start();
  
  // Git 상태 확인
  const { stdout: gitStatus } = await execa('git', ['status', '--porcelain']);
  if (gitStatus && options.env === 'production') {
    spinner.warn(chalk.yellow('⚠️  커밋되지 않은 변경사항이 있습니다'));
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '계속하시겠습니까?',
        default: false,
      },
    ]);
    
    if (!confirm) {
      process.exit(0);
    }
  }
  
  // 현재 브랜치 확인
  const { stdout: branch } = await execa('git', ['branch', '--show-current']);
  if (options.env === 'production' && branch !== 'main') {
    spinner.fail(chalk.red('❌ Production은 main 브랜치에서만 배포 가능'));
    process.exit(1);
  }
  
  spinner.succeed('사전 검사 완료');
  
  // 2. 테스트
  if (!options.skipTests) {
    const testSpinner = ora('테스트 실행 중...').start();
    
    try {
      await execa('bun', ['test'], { stdio: 'pipe' });
      testSpinner.succeed('테스트 통과');
    } catch (error) {
      testSpinner.fail('테스트 실패');
      process.exit(1);
    }
  }
  
  // 3. 빌드
  await buildCommand({ app: options.app });
  
  // 4. 승인 (Production)
  if (options.env === 'production' && options.requireApproval) {
    console.log(chalk.yellow('\n⚠️  Production 배포 승인 필요\n'));
    
    const { approve } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'approve',
        message: chalk.red('정말로 Production에 배포하시겠습니까?'),
        default: false,
      },
    ]);
    
    if (!approve) {
      console.log(chalk.gray('배포 취소됨'));
      process.exit(0);
    }
  }
  
  // 5. 배포
  const deploySpinner = ora('배포 중...').start();
  
  try {
    const version = await execa('git', ['rev-parse', '--short', 'HEAD']);
    
    // kubectl set image
    await execa('kubectl', [
      'set',
      'image',
      'deployment/api',
      `api=${REGISTRY}/api:${version.stdout}`,
      '-n',
      'kakao-cs-bot',
    ]);
    
    // Rollout 대기
    await execa('kubectl', [
      'rollout',
      'status',
      'deployment/api',
      '-n',
      'kakao-cs-bot',
      '--timeout=5m',
    ]);
    
    deploySpinner.succeed(chalk.green('배포 완료'));
    
    // 6. 검증
    const verifySpinner = ora('배포 검증 중...').start();
    
    await sleep(5000); // 5초 대기
    
    const healthCheck = await fetch(`${API_URL}/health`);
    if (healthCheck.ok) {
      verifySpinner.succeed('헬스 체크 통과');
    } else {
      verifySpinner.fail('헬스 체크 실패');
      
      // 자동 롤백 제안
      const { rollback } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'rollback',
          message: '자동으로 롤백하시겠습니까?',
          default: true,
        },
      ]);
      
      if (rollback) {
        await rollbackCommand({ env: options.env });
      }
    }
    
    // 7. 완료
    console.log(chalk.green.bold('\n✅ 배포 성공!\n'));
    console.log(`버전: ${version.stdout}`);
    console.log(`환경: ${options.env}`);
    console.log(`시간: ${new Date().toLocaleString()}`);
    
  } catch (error) {
    deploySpinner.fail(chalk.red('배포 실패'));
    console.error(error);
    process.exit(1);
  }
}
```

### 5. analytics
```bash
# 일일 통계
cs-bot analytics daily --start 2024-01-01 --end 2024-01-31

# 비용 분석
cs-bot analytics cost --month 2024-01

# 정확도 분석
cs-bot analytics accuracy --days 7

# 리포트 내보내기
cs-bot analytics export --format pdf --output report.pdf
```

### 6. 도움말
```bash
# 전체 도움말
cs-bot --help

# 특정 명령어 도움말
cs-bot agent --help
cs-bot knowledge add --help

# 버전
cs-bot --version

# 디버그 모드
DEBUG=* cs-bot agent start
```

## 단축키 (Alias)
```bash
# ~/.zshrc 또는 ~/.bashrc

# 자주 쓰는 명령어
alias csb='cs-bot'
alias csb-dev='cs-bot dev start'
alias csb-logs='cs-bot agent logs --follow'
alias csb-status='cs-bot agent status'
alias csb-deploy='cs-bot deploy push --env production'
```

## 예제 워크플로우

### 새 지식 추가
```bash
# 1. 인터랙티브로 추가
cs-bot knowledge add -i

# 2. 검색으로 확인
cs-bot knowledge search "정산"

# 3. 배포 (즉시 반영)
# (배포 불필요 - DB에 바로 저장)
```

### 프로덕션 배포
```bash
# 1. 현재 상태 확인
cs-bot agent status

# 2. 테스트
bun test

# 3. 빌드
cs-bot deploy build

# 4. Staging 배포
cs-bot deploy push --env staging

# 5. Staging 검증
# (수동 테스트)

# 6. Production 배포
cs-bot deploy push --env production --require-approval

# 7. 모니터링
cs-bot agent logs --follow
```

### 문제 해결
```bash
# 1. 로그 확인
cs-bot agent logs --name message --level error --since 1h

# 2. 상태 확인
cs-bot agent status

# 3. 재시작
cs-bot agent restart --name message

# 4. 롤백 (필요 시)
cs-bot deploy rollback --env production
```