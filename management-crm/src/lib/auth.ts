import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import type { Role } from '@prisma/client';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export interface AuthPayload {
  userId: number;
  username: string;
  role: Role;
  branch: string;
  displayName: string;
  mgmtTeam?: string | null;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, getJwtSecret()) as AuthPayload;
}

export function requireAuth(request: NextRequest): AuthPayload {
  const token = request.cookies.get('token')?.value;

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    return verifyToken(token);
  } catch {
    throw new Error('Unauthorized');
  }
}
