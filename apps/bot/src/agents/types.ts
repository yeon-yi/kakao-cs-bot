export type AgentType = 'coordinator' | 'message' | 'knowledge' | 'learning' | 'identity';
export type AgentStatus = 'IDLE' | 'BUSY' | 'UNHEALTHY';
export type TaskStatus = 'PENDING' | 'ASSIGNED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type TaskType = 'PROCESS_MESSAGE' | 'LEARN' | 'IDENTIFY';
export type MessageState = 'IDLE' | 'READING' | 'ANALYZING' | 'SEARCHING' | 'GENERATING' | 'HUMANIZING' | 'TYPING' | 'SENDING';

export interface AgentMessage {
  id: string;
  type: 'TASK' | 'RESULT' | 'ERROR' | 'HEARTBEAT';
  from: string;
  to: string | 'broadcast';
  payload: any;
  timestamp: number;
  correlationId?: string;
}

export interface Task {
  id: string;
  type: TaskType;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  data: any;
  assignedTo?: string;
  status: TaskStatus;
  createdAt: number;
  deadline?: number;
}

export interface AgentInfo {
  id: string;
  type: AgentType;
  status: AgentStatus;
  lastHeartbeat: number;
  currentTask: string | null;
  metrics: {
    tasksCompleted: number;
    avgProcessingTime: number;
    errorRate: number;
  };
}
