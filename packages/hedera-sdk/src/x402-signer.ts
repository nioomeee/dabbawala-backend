/**
 * x402 exact-scheme signer for Hedera.
 *
 * Implements the Hedera x402 exact-scheme from the official specification.
 * Ref: R-HE-4 https://docs.hedera.com/solutions/ai/x402/exact-scheme
 *
 * IMPORTANT (R-HE-1, trap §11): The Spend Controller is the SOLE signer of Hedera payments.
 * Robot and Fleet Brain hold no payment keys.
 */

import { AccountId, Client, Hbar, TransferTransaction } from "@hashgraph/sdk";
import type { X402ExactScheme, PaymentResult } from "./types.js";
import { isValidAccountId, buildHederaClient, type HederaClientConfig } from "./client.js";

export interface X402SignerOptions {
  payToOverride?: string;
  memo?: string;
  waitForConfirmation?: boolean;
  confirmationTimeoutMs?: number;
  /** Optional client config to create a new client instance (for isolated keys) */
  clientConfig?: HederaClientConfig;
  /** Or pass an existing client instance */
  client?: Client;
}

/**
 * Sign an x402 exact-scheme and execute the payment.
 *
 * @param scheme - The x402 exact-scheme to sign
 * @param options - Optional configuration for the payment
 * @returns PaymentResult with transaction ID and confirmation status
 */
export async function signX402Payment(
  scheme: X402ExactScheme,
  options: X402SignerOptions = {},
): Promise<PaymentResult> {
  const payTo = options.payToOverride ?? scheme.payTo;

  // Validate payTo address
  if (!isValidAccountId(payTo)) {
    throw new Error(`Invalid payTo account ID: ${payTo}`);
  }

  // Get or create client
  let client: Client;
  if (options.client) {
    client = options.client;
  } else if (options.clientConfig) {
    client = buildHederaClient(options.clientConfig);
  } else {
    // Fallback - create a default client (will need operator set by caller)
    throw new Error("Either client or clientConfig must be provided");
  }

  const operator = client.getOperator();
  if (!operator) {
    throw new Error("Hedera client operator not configured");
  }
  const amount = BigInt(scheme.amount);

  // Build transfer transaction (debit operator, credit payee)
  // Note: Hedera testnet USDC transfers use HBAR for simplicity; 
  // actual USDC token transfers require tokenTransfer() calls
  const transaction = new TransferTransaction()
    .addHbarTransfer(operator.accountId, Hbar.fromTinybars(-Number(amount)))
    .addHbarTransfer(AccountId.fromString(payTo), Hbar.fromTinybars(Number(amount)))
    .setTransactionMemo(options.memo ?? `x402 payment: ${scheme.amount} ${scheme.asset}`);

  // Execute transaction
  const txResponse = await transaction.execute(client);
  const txId = txResponse.transactionId.toString();

  // Determine confirmation status
  let confirmed = false;
  if (options.waitForConfirmation !== false) {
    const timeout = options.confirmationTimeoutMs ?? 30000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const receipt = await txResponse.getReceipt(client);
      if (receipt.status && receipt.status.toString().startsWith("SUCCESS")) {
        confirmed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return {
    transactionId: txId,
    scheme: {
      ...scheme,
      ...(options.memo ? { memo: options.memo } : {}),
    },
    confirmed,
    nodeStatus: confirmed ? "success" : "pending_confirmation",
  };
}

/**
 * Build an x402 payment header from the exact-scheme.
 * Used for frontend integration (R-HE-4).
 */
export function buildX402Header(scheme: X402ExactScheme): Record<string, string> {
  return {
    network: scheme.network,
    asset: scheme.asset,
    amount: scheme.amount,
    fee: scheme.fee,
    payTo: scheme.payTo,
    expiry: scheme.expiry ?? Date.now().toString(),
    memo: scheme.memo ?? "",
    ...(scheme.royaltyRecipient ? { royaltyRecipient: scheme.royaltyRecipient } : {}),
    ...(scheme.royaltyMaxFee ? { royaltyMaxFee: scheme.royaltyMaxFee } : {}),
    ...(scheme.royaltyFeeSimple ? { royaltyFeeSimple: scheme.royaltyFeeSimple.toString() } : {}),
    ...(scheme.royaltyPercentageNumerator
      ? { royaltyPercentageNumerator: scheme.royaltyPercentageNumerator.toString() }
      : {}),
    ...(scheme.royaltyPercentageDenominator
      ? { royaltyPercentageDenominator: scheme.royaltyPercentageDenominator.toString() }
      : {}),
  };
}

// Re-export isValidAccountId from client
export { isValidAccountId } from "./client.js";