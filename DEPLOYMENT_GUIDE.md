# 배포 가이드 - 완전판

## 인프라 아키텍처
```
┌─────────────────────────────────────────────────────────┐
│ Cloudflare (Edge)                                       │
│ - Workers (빠른 응답)                                   │
│ - KV Store (캐시)                                       │
│ - CDN                                                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ GCP Load Balancer                                       │
│ - Global LB                                             │
│ - SSL/TLS Termination                                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ GKE Autopilot (Kubernetes)                             │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                   │
│  │ API Pods     │  │ Bot Pods     │                   │
│  │ (tRPC)       │  │ (Agents)     │                   │
│  │ replicas:3-10│  │ replicas:3-10│                   │
│  └──────────────┘  └──────────────┘                   │
│                                                         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ External Services                                       │
│                                                         │
│ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│ │ Supabase    │  │ Upstash     │  │ Gemini API  │    │
│ │ (DB+Vector) │  │ (Redis)     │  │ (AI)        │    │
│ └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 1단계: 환경 준비

### GCP 프로젝트 생성
```bash
# gcloud CLI 설치 (macOS)
brew install google-cloud-sdk

# 인증
gcloud auth login
gcloud auth application-default login

# 프로젝트 생성
export PROJECT_ID="kakao-cs-bot-prod"
gcloud projects create $PROJECT_ID
gcloud config set project $PROJECT_ID

# 빌링 활성화 (필수)
# https://console.cloud.google.com/billing

# APIs 활성화
gcloud services enable \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  compute.googleapis.com \
  cloudresourcemanager.googleapis.com \
  servicenetworking.googleapis.com
```

### Artifact Registry (Docker 이미지 저장소)
```bash
# 레지스트리 생성
export REGION="asia-northeast3"  # 서울
gcloud artifacts repositories create kakao-cs-bot \
  --repository-format=docker \
  --location=$REGION \
  --description="Kakao CS Bot Docker images"

# Docker 인증 설정
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

### GKE Autopilot 클러스터 생성
```bash
# 클러스터 생성 (Autopilot - 관리 불필요)
gcloud container clusters create-auto kakao-cs-bot \
  --region=$REGION \
  --release-channel=regular \
  --enable-autorepair \
  --enable-autoupgrade

# kubectl 설정
gcloud container clusters get-credentials kakao-cs-bot --region=$REGION

# 확인
kubectl cluster-info
kubectl get nodes
```

## 2단계: 시크릿 설정

### Kubernetes Secrets
```bash
# Supabase
kubectl create secret generic supabase \
  --from-literal=url='https://xxx.supabase.co' \
  --from-literal=anon-key='eyJhbGc...' \
  --from-literal=service-role-key='eyJhbGc...'

# Redis (Upstash)
kubectl create secret generic redis \
  --from-literal=url='rediss://default:xxx@xxx.upstash.io:6379'

# AI APIs
kubectl create secret generic ai \
  --from-literal=gemini-key='AIza...' \
  --from-literal=claude-key='sk-ant-...' \
  --from-literal=openai-key='sk-proj-...'

# Kakao
kubectl create secret generic kakao \
  --from-literal=device-id='xxx' \
  --from-literal=oauth-token='xxx'

# Monitoring
kubectl create secret generic monitoring \
  --from-literal=datadog-api-key='xxx' \
  --from-literal=sentry-dsn='https://xxx@sentry.io/xxx'

# 확인
kubectl get secrets
```

### ConfigMap
```bash
# 설정 생성
kubectl create configmap app-config \
  --from-literal=NODE_ENV='production' \
  --from-literal=LOG_LEVEL='info' \
  --from-literal=API_URL='https://api.yourcompany.com'
```

## 3단계: Docker 이미지 빌드

### Dockerfile (API)
```dockerfile
# infra/docker/api.Dockerfile
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# 의존성 설치
FROM base AS deps
COPY package.json bun.lockb ./
COPY apps/api/package.json apps/api/
COPY packages/*/package.json packages/*/
RUN bun install --frozen-lockfile --production

# 빌드
FROM base AS builder
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN bun run build --filter=api

# 프로덕션
FROM base AS runner
ENV NODE_ENV=production

# 보안: non-root 유저
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 apiuser

COPY --from=builder --chown=apiuser:nodejs /app/apps/api/dist ./
COPY --from=deps --chown=apiuser:nodejs /app/node_modules ./node_modules

USER apiuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run healthcheck.js || exit 1

CMD ["bun", "run", "server.js"]
```

### Dockerfile (Bot)
```dockerfile
# infra/docker/bot.Dockerfile
FROM node:20-alpine AS base

# Appium 의존성
RUN apk add --no-cache \
  openjdk11-jre \
  android-tools \
  python3 \
  py3-pip

WORKDIR /app

# 의존성
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/bot/package.json apps/bot/
RUN npm ci --only=production

# 빌드
FROM base AS builder
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN npm run build --workspace=bot

# 프로덕션
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 botuser

COPY --from=builder --chown=botuser:nodejs /app/apps/bot/dist ./
COPY --from=deps --chown=botuser:nodejs /app/node_modules ./node_modules

USER botuser

# ADB 포트
EXPOSE 5037

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node healthcheck.js || exit 1

CMD ["node", "worker.js"]
```

### 빌드 & 푸시 스크립트
```bash
#!/bin/bash
# scripts/deploy/build.sh

set -e

PROJECT_ID="kakao-cs-bot-prod"
REGION="asia-northeast3"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/kakao-cs-bot"

# 버전 (Git SHA)
VERSION=$(git rev-parse --short HEAD)

echo "🔨 Building images (version: ${VERSION})"

# API 빌드
docker build \
  -f infra/docker/api.Dockerfile \
  -t ${REGISTRY}/api:${VERSION} \
  -t ${REGISTRY}/api:latest \
  .

# Bot 빌드
docker build \
  -f infra/docker/bot.Dockerfile \
  -t ${REGISTRY}/bot:${VERSION} \
  -t ${REGISTRY}/bot:latest \
  .

echo "📤 Pushing images"

docker push ${REGISTRY}/api:${VERSION}
docker push ${REGISTRY}/api:latest
docker push ${REGISTRY}/bot:${VERSION}
docker push ${REGISTRY}/bot:latest

echo "✅ Images built and pushed"
echo "   API: ${REGISTRY}/api:${VERSION}"
echo "   Bot: ${REGISTRY}/bot:${VERSION}"
```

## 4단계: Kubernetes 매니페스트

### Namespace
```yaml
# infra/k8s/base/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kakao-cs-bot
  labels:
    name: kakao-cs-bot
    environment: production
```

### API Deployment
```yaml
# infra/k8s/api/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: kakao-cs-bot
  labels:
    app: api
    version: v1
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0  # Zero-downtime
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
        version: v1
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      # 보안: non-root
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      
      # Anti-affinity (다른 노드에 분산)
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - api
              topologyKey: kubernetes.io/hostname
      
      containers:
      - name: api
        image: asia-northeast3-docker.pkg.dev/kakao-cs-bot-prod/kakao-cs-bot/api:latest
        imagePullPolicy: Always
        
        ports:
        - name: http
          containerPort: 3000
          protocol: TCP
        
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
        
        # Secrets
        - name: SUPABASE_URL
          valueFrom:
            secretKeyRef:
              name: supabase
              key: url
        - name: SUPABASE_KEY
          valueFrom:
            secretKeyRef:
              name: supabase
              key: service-role-key
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis
              key: url
        - name: GEMINI_API_KEY
          valueFrom:
            secretKeyRef:
              name: ai
              key: gemini-key
        
        # 리소스 제한
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        
        # Health checks
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        
        # Graceful shutdown
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
      
      # Termination grace period
      terminationGracePeriodSeconds: 30
```

### API Service
```yaml
# infra/k8s/api/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: kakao-cs-bot
  labels:
    app: api
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
    name: http
  selector:
    app: api
```

### API HPA (Auto-scaling)
```yaml
# infra/k8s/api/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: kakao-cs-bot
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
  # CPU 기반
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  
  # 메모리 기반
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  
  # 커스텀 메트릭 (Prometheus)
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "100"
  
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분 안정화
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0  # 즉시
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
      - type: Pods
        value: 2
        periodSeconds: 30
      selectPolicy: Max
```

### Bot Deployment (StatefulSet)
```yaml
# infra/k8s/bot/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: bot
  namespace: kakao-cs-bot
spec:
  serviceName: bot
  replicas: 3
  selector:
    matchLabels:
      app: bot
  template:
    metadata:
      labels:
        app: bot
    spec:
      # USB 디바이스 접근 (DaemonSet으로 변경 고려)
      hostNetwork: false
      
      containers:
      - name: bot
        image: asia-northeast3-docker.pkg.dev/kakao-cs-bot-prod/kakao-cs-bot/bot:latest
        
        env:
        - name: BOT_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis
              key: url
        
        # USB 디바이스 마운트 (privileged 필요)
        securityContext:
          privileged: true
        
        volumeMounts:
        - name: dev-bus-usb
          mountPath: /dev/bus/usb
        
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
      
      volumes:
      - name: dev-bus-usb
        hostPath:
          path: /dev/bus/usb
          type: Directory
  
  # Persistent Volume (에이전트 상태 저장)
  volumeClaimTemplates:
  - metadata:
      name: bot-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
```

### Ingress
```yaml
# infra/k8s/api/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
  namespace: kakao-cs-bot
  annotations:
    kubernetes.io/ingress.class: "gce"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    # CORS
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://admin.yourcompany.com"
    # Rate limiting
    nginx.ingress.kubernetes.io/limit-rps: "100"
spec:
  tls:
  - hosts:
    - api.yourcompany.com
    secretName: api-tls
  rules:
  - host: api.yourcompany.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api
            port:
              number: 80
```

## 5단계: CI/CD (GitHub Actions)
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  PROJECT_ID: kakao-cs-bot-prod
  REGION: asia-northeast3
  GKE_CLUSTER: kakao-cs-bot

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - uses: oven-sh/setup-bun@v1
    
    - name: Install dependencies
      run: bun install
    
    - name: Run tests
      run: bun test
    
    - name: Lint
      run: bun run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Cloud SDK
      uses: google-github-actions/setup-gcloud@v2
      with:
        service_account_key: ${{ secrets.GCP_SA_KEY }}
        project_id: ${{ env.PROJECT_ID }}
    
    - name: Configure Docker
      run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev
    
    - name: Build images
      run: |
        VERSION=${{ github.sha }}
        ./scripts/deploy/build.sh
      env:
        VERSION: ${{ github.sha }}
    
    - name: Push images
      run: |
        docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/kakao-cs-bot/api:${{ github.sha }}
        docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/kakao-cs-bot/bot:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Cloud SDK
      uses: google-github-actions/setup-gcloud@v2
      with:
        service_account_key: ${{ secrets.GCP_SA_KEY }}
        project_id: ${{ env.PROJECT_ID }}
    
    - name: Get GKE credentials
      run: |
        gcloud container clusters get-credentials ${{ env.GKE_CLUSTER }} \
          --region ${{ env.REGION }}
    
    - name: Deploy to GKE
      run: |
        kubectl set image deployment/api \
          api=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/kakao-cs-bot/api:${{ github.sha }} \
          -n kakao-cs-bot
        
        kubectl set image statefulset/bot \
          bot=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/kakao-cs-bot/bot:${{ github.sha }} \
          -n kakao-cs-bot
    
    - name: Wait for rollout
      run: |
        kubectl rollout status deployment/api -n kakao-cs-bot
        kubectl rollout status statefulset/bot -n kakao-cs-bot
    
    - name: Verify deployment
      run: |
        kubectl get pods -n kakao-cs-bot
        kubectl get svc -n kakao-cs-bot

  notify:
    needs: deploy
    runs-on: ubuntu-latest
    if: always()
    steps:
    - name: Slack notification
      uses: 8398a7/action-slack@v3
      with:
        status: ${{ job.status }}
        text: |
          Deployment ${{ job.status }}
          Commit: ${{ github.sha }}
          Author: ${{ github.actor }}
        webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

## 6단계: 모니터링 설정

### Datadog Agent
```yaml
# infra/k8s/monitoring/datadog.yaml
apiVersion: v1
kind: Secret
metadata:
  name: datadog-secret
  namespace: kakao-cs-bot
type: Opaque
data:
  api-key: <BASE64_ENCODED_KEY>
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: datadog-agent
  namespace: kakao-cs-bot
spec:
  selector:
    matchLabels:
      app: datadog-agent
  template:
    metadata:
      labels:
        app: datadog-agent
    spec:
      serviceAccountName: datadog-agent
      containers:
      - name: datadog-agent
        image: datadog/agent:latest
        env:
        - name: DD_API_KEY
          valueFrom:
            secretKeyRef:
              name: datadog-secret
              key: api-key
        - name: DD_SITE
          value: "datadoghq.com"
        - name: DD_LOGS_ENABLED
          value: "true"
        - name: DD_APM_ENABLED
          value: "true"
        - name: DD_PROCESS_AGENT_ENABLED
          value: "true"
        
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        
        volumeMounts:
        - name: dockersocket
          mountPath: /var/run/docker.sock
        - name: procdir
          mountPath: /host/proc
          readOnly: true
        - name: cgroups
          mountPath: /host/sys/fs/cgroup
          readOnly: true
      
      volumes:
      - name: dockersocket
        hostPath:
          path: /var/run/docker.sock
      - name: procdir
        hostPath:
          path: /proc
      - name: cgroups
        hostPath:
          path: /sys/fs/cgroup
```

## 7단계: 배포 스크립트
```bash
#!/bin/bash
# scripts/deploy/deploy-prod.sh

set -e

echo "🚀 Starting production deployment"

# 환경변수 체크
if [ -z "$GCP_PROJECT_ID" ]; then
  echo "❌ GCP_PROJECT_ID not set"
  exit 1
fi

# 1. 빌드
echo "📦 Building..."
./scripts/deploy/build.sh

# 2. 테스트
echo "🧪 Running tests..."
bun test

# 3. 배포
echo "🚢 Deploying to GKE..."
kubectl apply -f infra/k8s/base/
kubectl apply -f infra/k8s/api/
kubectl apply -f infra/k8s/bot/

# 4. 롤아웃 대기
echo "⏳ Waiting for rollout..."
kubectl rollout status deployment/api -n kakao-cs-bot --timeout=5m
kubectl rollout status statefulset/bot -n kakao-cs-bot --timeout=5m

# 5. 헬스체크
echo "🏥 Health check..."
kubectl run healthcheck --rm -i --tty --image=curlimages/curl -- \
  curl -f http://api.kakao-cs-bot.svc.cluster.local/health

# 6. 완료
echo "✅ Deployment complete!"
kubectl get pods -n kakao-cs-bot
```

## 롤백 절차
```bash
#!/bin/bash
# scripts/deploy/rollback.sh

NAMESPACE="kakao-cs-bot"

# API 롤백
kubectl rollout undo deployment/api -n $NAMESPACE

# Bot 롤백
kubectl rollout undo statefulset/bot -n $NAMESPACE

# 특정 리비전으로
# kubectl rollout undo deployment/api --to-revision=2 -n $NAMESPACE
```

## 비용 최적화
```yaml
# GKE Autopilot 비용 절감
# - Spot Instances (최대 91% 할인)

apiVersion: v1
kind: Pod
metadata:
  name: api
spec:
  nodeSelector:
    cloud.google.com/gke-spot: "true"
  tolerations:
  - key: cloud.google.com/gke-spot
    operator: Equal
    value: "true"
    effect: NoSchedule
```

## 예상 비용 (월간)
```
GKE Autopilot:
- API Pods (3-10): $50-150
- Bot Pods (3): $80

Artifact Registry: $5
Load Balancer: $18
Egress (10GB): $1

Supabase: $0 (Free)
Upstash Redis: $0 (Free)
Cloudflare: $0 (Free)

AI APIs: $30

총 월간 비용: $184-284
```