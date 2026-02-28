# 관리자 대시보드 상세 스펙

## 기술 스택
```typescript
// Next.js 15 App Router
framework: "Next.js 15"
language: "TypeScript 5.3"
styling: "Tailwind CSS 3.4"
ui: "shadcn/ui"
state: "TanStack Query v5"
api: "tRPC"
charts: "Recharts"
forms: "React Hook Form + Zod"
auth: "NextAuth.js v5"
```

## 페이지 구조
```
/admin
├── /login                    # 로그인
├── /dashboard               # 메인 대시보드
│   ├── /analytics           # 분석
│   ├── /realtime            # 실시간 모니터링
│   └── /reports             # 리포트
├── /knowledge              # 지식 관리
│   ├── /list                # 지식 목록
│   ├── /add                 # 지식 추가
│   ├── /edit/[id]           # 지식 수정
│   └── /import              # 일괄 가져오기
├── /conversations          # 대화 이력
│   ├── /list                # 대화 목록
│   └── /view/[id]           # 대화 상세
├── /config                 # 설정
│   ├── /general             # 일반 설정
│   ├── /prompts             # 프롬프트 관리
│   ├── /ai                  # AI 설정
│   └── /features            # Feature Flags
├── /identity               # 신원 관리
│   ├── /staff               # 직원 목록
│   ├── /unknown             # 미확인 사용자
│   └── /confirm             # 확인 대기
└── /logs                   # 로그
    ├── /errors              # 에러 로그
    └── /audit               # 감사 로그
```

## 컴포넌트 설계

### 1. 실시간 대시보드
```typescript
// app/(dashboard)/realtime/page.tsx
'use client';

import { trpc } from '@/lib/trpc';
import { RealtimeChart } from '@/components/charts/realtime';
import { StatCard } from '@/components/dashboard/stat-card';
import { MessageList } from '@/components/messages/message-list';

export default function RealtimeDashboard() {
  // WebSocket 구독
  trpc.analytics.realtime.useSubscription(undefined, {
    onData: (data) => {
      // 실시간 데이터 업데이트
      updateMetrics(data);
    },
  });
  
  // 최근 메시지
  const { data: recentMessages } = trpc.messages.recent.useQuery({
    limit: 20,
  });
  
  return (
    <div className="grid grid-cols-4 gap-4">
      {/* 주요 지표 */}
      <StatCard
        title="초당 메시지"
        value={metrics.messagesPerSecond}
        unit="msg/s"
        trend={metrics.trend}
      />
      
      <StatCard
        title="활성 사용자"
        value={metrics.activeUsers}
        unit="users"
      />
      
      <StatCard
        title="평균 응답시간"
        value={metrics.avgLatency}
        unit="ms"
      />
      
      <StatCard
        title="에러율"
        value={metrics.errorRate}
        unit="%"
        alert={metrics.errorRate > 5}
      />
      
      {/* 실시간 차트 */}
      <div className="col-span-4">
        <RealtimeChart data={timeSeriesData} />
      </div>
      
      {/* 최근 메시지 */}
      <div className="col-span-2">
        <MessageList messages={recentMessages} />
      </div>
      
      {/* AI 사용 현황 */}
      <div className="col-span-2">
        <AIUsageChart data={aiUsage} />
      </div>
    </div>
  );
}
```

### 2. 지식 관리
```typescript
// app/knowledge/add/page.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';

const knowledgeSchema = z.object({
  question: z.string().min(5).max(500),
  answer: z.string().min(10).max(2000),
  category: z.string().min(1),
  tier: z.enum(['1', '2', '3']).default('2'),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

type KnowledgeForm = z.infer<typeof knowledgeSchema>;

export default function AddKnowledge() {
  const utils = trpc.useUtils();
  
  const { mutate, isLoading } = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate();
      toast.success('지식이 추가되었습니다');
      router.push('/knowledge');
    },
  });
  
  const form = useForm<KnowledgeForm>({
    resolver: zodResolver(knowledgeSchema),
    defaultValues: {
      tier: '2',
    },
  });
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutate(data))}>
        <FormField
          control={form.control}
          name="question"
          render={({ field }) => (
            <FormItem>
              <FormLabel>질문</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="광고주가 물어볼 질문을 입력하세요"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="answer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>답변</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="답변 내용을 입력하세요"
                  rows={8}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                프로페셔널한 톤으로 작성해주세요
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>카테고리</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="카테고리 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="정산">정산</SelectItem>
                  <SelectItem value="계약">계약</SelectItem>
                  <SelectItem value="시스템">시스템 사용</SelectItem>
                  <SelectItem value="기타">기타</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="tier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tier</FormLabel>
              <RadioGroup onValueChange={field.onChange} defaultValue={field.value}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="1" id="tier1" />
                  <Label htmlFor="tier1">Tier 1 (공식 자료)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="2" id="tier2" />
                  <Label htmlFor="tier2">Tier 2 (학습된 지식)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="3" id="tier3" />
                  <Label htmlFor="tier3">Tier 3 (대화 패턴)</Label>
                </div>
              </RadioGroup>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit" disabled={isLoading}>
          {isLoading ? '저장 중...' : '저장'}
        </Button>
      </form>
    </Form>
  );
}
```

### 3. 프롬프트 에디터
```typescript
// app/config/prompts/page.tsx
'use client';

import { Editor } from '@monaco-editor/react';
import { trpc } from '@/lib/trpc';

export default function PromptEditor() {
  const [selectedPrompt, setSelectedPrompt] = useState('context_analysis');
  
  const { data: prompt } = trpc.prompts.get.useQuery({
    name: selectedPrompt,
  });
  
  const { mutate: updatePrompt } = trpc.prompts.update.useMutation({
    onSuccess: () => {
      toast.success('프롬프트가 업데이트되었습니다');
    },
  });
  
  return (
    <div className="grid grid-cols-4 gap-4">
      {/* 프롬프트 목록 */}
      <div className="col-span-1">
        <PromptList
          selected={selectedPrompt}
          onSelect={setSelectedPrompt}
        />
      </div>
      
      {/* 에디터 */}
      <div className="col-span-3">
        <div className="mb-4">
          <h2>{prompt?.name}</h2>
          <p className="text-sm text-muted-foreground">
            버전 {prompt?.version}
          </p>
        </div>
        
        <Editor
          height="600px"
          language="markdown"
          value={prompt?.template}
          onChange={(value) => setEditedTemplate(value)}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
          }}
        />
        
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              updatePrompt({
                name: selectedPrompt,
                template: editedTemplate,
                reason: updateReason,
              });
            }}
          >
            저장
          </Button>
          
          <Button variant="outline" onClick={() => setShowPreview(true)}>
            미리보기
          </Button>
          
          <Button variant="outline" onClick={() => setShowHistory(true)}>
            변경 이력
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### 4. 신원 확인 대기열
```typescript
// app/identity/confirm/page.tsx
'use client';

export default function IdentityConfirmQueue() {
  const { data: unknownUsers } = trpc.identity.listUnknown.useQuery();
  
  const { mutate: confirmIdentity } = trpc.identity.confirm.useMutation({
    onSuccess: () => {
      utils.identity.listUnknown.invalidate();
      toast.success('신원이 확인되었습니다');
    },
  });
  
  return (
    <div>
      <h1>신원 확인 대기</h1>
      
      {unknownUsers?.map((user) => (
        <Card key={user.id}>
          <CardHeader>
            <CardTitle>{user.kakaoName}</CardTitle>
            <CardDescription>
              {user.roomId} · {user.detectedAt}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <div className="space-y-2">
              <div>
                <Label>AI 예측</Label>
                <p>{user.predictedRole} (확신도: {user.confidence}%)</p>
              </div>
              
              <div>
                <Label>최근 메시지</Label>
                <div className="bg-muted p-2 rounded text-sm">
                  {user.recentMessages.map((msg) => (
                    <p key={msg.id}>{msg.content}</p>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
          
          <CardFooter className="gap-2">
            <Button
              onClick={() => {
                confirmIdentity({
                  userId: user.id,
                  role: 'COMPANY_STAFF',
                });
              }}
            >
              직원으로 등록
            </Button>
            
            <Button
              variant="secondary"
              onClick={() => {
                confirmIdentity({
                  userId: user.id,
                  role: 'ADVERTISER',
                });
              }}
            >
              광고주로 확인
            </Button>
            
            <Button variant="outline">
              건너뛰기
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
```