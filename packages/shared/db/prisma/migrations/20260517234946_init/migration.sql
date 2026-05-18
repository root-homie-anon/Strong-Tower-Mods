-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "nexusIsPremium" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "nexus_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "nexusUserId" INTEGER NOT NULL,
    "nexusUsername" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nexus_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stripe_customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "defaultPaymentMethodId" TEXT,
    "spendCeilingMicrodollars" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "stripe_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" DATETIME NOT NULL,
    "currentPeriodEnd" DATETIME NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jwtJti" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "stripePreAuthIntentId" TEXT,
    "preAuthAmountMicrodollars" INTEGER,
    "meteredTotalMicrodollars" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "api_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "metered_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apiSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costMicrodollars" INTEGER NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "metered_usage_apiSessionId_fkey" FOREIGN KEY ("apiSessionId") REFERENCES "api_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "metered_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "nexus_identities_userId_key" ON "nexus_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "nexus_identities_nexusUserId_key" ON "nexus_identities"("nexusUserId");

-- CreateIndex
CREATE INDEX "nexus_identities_nexusUserId_idx" ON "nexus_identities"("nexusUserId");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_customers_userId_key" ON "stripe_customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_customers_stripeCustomerId_key" ON "stripe_customers"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "stripe_customers_stripeCustomerId_idx" ON "stripe_customers"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_stripeSubscriptionId_idx" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "api_sessions_jwtJti_key" ON "api_sessions"("jwtJti");

-- CreateIndex
CREATE INDEX "api_sessions_userId_openedAt_idx" ON "api_sessions"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "metered_usage_userId_occurredAt_idx" ON "metered_usage"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "metered_usage_apiSessionId_idx" ON "metered_usage"("apiSessionId");
