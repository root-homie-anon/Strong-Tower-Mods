/**
 * User + NexusIdentity repository.
 *
 * The only legal way to create a User is via :func:`upsertFromNexus`,
 * which is idempotent and atomic: a single transaction creates or
 * updates the User row and the NexusIdentity row together so a partial
 * insert cannot leave a User without an identity.
 */

import type { User, NexusIdentity, Prisma } from '../../prisma-client/index.js';
import { prisma } from '../client.js';

export interface NexusProfile {
  nexusUserId: number;
  nexusUsername: string;
  displayName?: string;
  avatarUrl?: string;
  isPremium?: boolean;
}

/**
 * Idempotently materialise a User + NexusIdentity for the given Nexus
 * profile. Returns the User row joined with its identity.
 *
 * Looked up by NexusIdentity.nexusUserId because that is the only
 * Nexus-side identifier guaranteed stable across renames.
 */
export async function upsertFromNexus(
  profile: NexusProfile
): Promise<User & { nexusIdentity: NexusIdentity }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.nexusIdentity.findUnique({
      where: { nexusUserId: profile.nexusUserId },
      include: { user: true },
    });

    if (existing) {
      const updatedUser = await tx.user.update({
        where: { id: existing.userId },
        data: {
          displayName: profile.displayName ?? null,
          avatarUrl: profile.avatarUrl ?? null,
          nexusIsPremium: profile.isPremium ?? false,
        },
      });
      const updatedIdentity = await tx.nexusIdentity.update({
        where: { id: existing.id },
        data: { nexusUsername: profile.nexusUsername },
      });
      return { ...updatedUser, nexusIdentity: updatedIdentity };
    }

    const created = await tx.user.create({
      data: {
        displayName: profile.displayName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        nexusIsPremium: profile.isPremium ?? false,
        nexusIdentity: {
          create: {
            nexusUserId: profile.nexusUserId,
            nexusUsername: profile.nexusUsername,
          },
        },
      },
      include: { nexusIdentity: true },
    });
    // Prisma's typed include narrows nexusIdentity to nullable; we
    // know it is non-null because we just created it.
    if (!created.nexusIdentity) {
      throw new Error('Invariant: nexusIdentity missing after create');
    }
    return { ...created, nexusIdentity: created.nexusIdentity };
  });
}

export async function findById(userId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function findByNexusUserId(
  nexusUserId: number
): Promise<(User & { nexusIdentity: NexusIdentity }) | null> {
  const identity = await prisma.nexusIdentity.findUnique({
    where: { nexusUserId },
    include: { user: true },
  });
  if (!identity) return null;
  const { user, ...rest } = identity;
  return { ...user, nexusIdentity: rest as NexusIdentity };
}
