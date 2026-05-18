/**
 * MeteredUsage repository.
 *
 * Recording is a write-and-denormalize: every emitted usage row
 * atomically updates ApiSession.meteredTotalMicrodollars so the
 * session-close pre-auth capture path is a single fast lookup
 * instead of an aggregate query over millions of rows.
 */

import type { MeteredUsage, Prisma } from '../../prisma-client/index.js';
import { prisma } from '../client.js';

export interface RecordUsageInput {
  apiSessionId: string;
  userId: string;
  metric: string;
  quantity: number;
  costMicrodollars: number;
}

export async function record(input: RecordUsageInput): Promise<MeteredUsage> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.meteredUsage.create({ data: input });
    await tx.apiSession.update({
      where: { id: input.apiSessionId },
      data: {
        meteredTotalMicrodollars: { increment: input.costMicrodollars },
      },
    });
    return row;
  });
}

export async function sumForSession(apiSessionId: string): Promise<number> {
  const session = await prisma.apiSession.findUnique({
    where: { id: apiSessionId },
    select: { meteredTotalMicrodollars: true },
  });
  return session?.meteredTotalMicrodollars ?? 0;
}

export async function sumForUserSince(
  userId: string,
  since: Date
): Promise<number> {
  const aggregate = await prisma.meteredUsage.aggregate({
    where: { userId, occurredAt: { gte: since } },
    _sum: { costMicrodollars: true },
  });
  return aggregate._sum.costMicrodollars ?? 0;
}
