/**
 * Tier catalog — the single source of truth for what each tier
 * costs, what it unlocks, and how the cloud API gates features.
 *
 * Prices are in microdollars (1e-6 USD) so they can be added to
 * MeteredUsage.costMicrodollars without any unit conversion. This
 * matches the existing convention in shared/api/companion's
 * computeBillingMetric.
 */

export type BillingTier =
  | 'basic'
  | 'premium'
  | 'custom'
  | 'creator'
  | 'bundle_basic_creator'
  | 'bundle_premium_creator'
  | 'bundle_custom_creator';

export interface TierConfig {
  tier: BillingTier;
  displayName: string;
  /** Base monthly fee in microdollars. */
  monthlyFeeMicrodollars: number;
  /** Metered rate in microdollars per minute, or null for fixed-price. */
  meteredRatePerMinuteMicrodollars: number | null;
  /** Custom tier requires Stripe pre-authorization per session. */
  requiresPreAuth: boolean;
  /** Feature gates. */
  features: {
    voiceEnabled: boolean;
    customCharacter: boolean;
    memoryEnabled: boolean;
    creatorIncluded: boolean;
  };
}

export const TIER_CATALOG: Readonly<Record<BillingTier, TierConfig>> = Object.freeze({
  basic: {
    tier: 'basic',
    displayName: 'Companion Basic',
    monthlyFeeMicrodollars: 9_990_000,
    meteredRatePerMinuteMicrodollars: null,
    requiresPreAuth: false,
    features: {
      voiceEnabled: false,
      customCharacter: false,
      memoryEnabled: false,
      creatorIncluded: false,
    },
  },
  premium: {
    tier: 'premium',
    displayName: 'Companion Premium',
    monthlyFeeMicrodollars: 24_990_000,
    meteredRatePerMinuteMicrodollars: null,
    requiresPreAuth: false,
    features: {
      voiceEnabled: true,
      customCharacter: false,
      memoryEnabled: true,
      creatorIncluded: false,
    },
  },
  custom: {
    tier: 'custom',
    displayName: 'Companion Custom',
    monthlyFeeMicrodollars: 19_990_000,
    meteredRatePerMinuteMicrodollars: 350_000,
    requiresPreAuth: true,
    features: {
      voiceEnabled: true,
      customCharacter: true,
      memoryEnabled: true,
      creatorIncluded: false,
    },
  },
  creator: {
    tier: 'creator',
    displayName: 'Mod Creator',
    monthlyFeeMicrodollars: 0,
    meteredRatePerMinuteMicrodollars: null,
    requiresPreAuth: false,
    features: {
      voiceEnabled: false,
      customCharacter: false,
      memoryEnabled: false,
      creatorIncluded: true,
    },
  },
  bundle_basic_creator: {
    tier: 'bundle_basic_creator',
    displayName: 'Companion Basic + Creator',
    monthlyFeeMicrodollars: 29_990_000,
    meteredRatePerMinuteMicrodollars: null,
    requiresPreAuth: false,
    features: {
      voiceEnabled: false,
      customCharacter: false,
      memoryEnabled: false,
      creatorIncluded: true,
    },
  },
  bundle_premium_creator: {
    tier: 'bundle_premium_creator',
    displayName: 'Companion Premium + Creator',
    monthlyFeeMicrodollars: 39_990_000,
    meteredRatePerMinuteMicrodollars: null,
    requiresPreAuth: false,
    features: {
      voiceEnabled: true,
      customCharacter: false,
      memoryEnabled: true,
      creatorIncluded: true,
    },
  },
  bundle_custom_creator: {
    tier: 'bundle_custom_creator',
    displayName: 'Companion Custom + Creator',
    monthlyFeeMicrodollars: 59_990_000,
    meteredRatePerMinuteMicrodollars: 350_000,
    requiresPreAuth: true,
    features: {
      voiceEnabled: true,
      customCharacter: true,
      memoryEnabled: true,
      creatorIncluded: true,
    },
  },
});

export function getTierConfig(tier: string): TierConfig {
  const config = TIER_CATALOG[tier as BillingTier];
  if (!config) {
    throw new Error(`Unknown billing tier: ${tier}`);
  }
  return config;
}
