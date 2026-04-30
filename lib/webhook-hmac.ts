/**
 * Machine Webhook HMAC-SHA-512 Validator
 *
 * Implements the signature validation as per Machine API documentation:
 *   - Header: `signature-v2`
 *   - Algorithm: HMAC-SHA-512
 *   - Key: MACHINE_API_KEY (env var)
 *   - Input: Raw request body (exact bytes, no re-serialization)
 *
 * ⚠ CRITICAL: You MUST read the body with `request.text()` BEFORE calling
 *   this function. Using `request.json()` first WILL break the signature
 *   because JSON.parse + JSON.stringify can reorder/format differently.
 *
 * Usage:
 *   const rawBody = await request.text();
 *   const validation = await validateMachineSignature(request, rawBody);
 *   if (!validation.valid) return NextResponse.json(validation.error, { status: 200 });
 *   const body = JSON.parse(rawBody); // safe to parse AFTER validation
 */

export interface ValidationResult {
  valid: boolean;
  error?: { success: false; error: string };
}

/**
 * Validate the HMAC-SHA-512 signature from Machine API webhook.
 *
 * @param request - The incoming Request (to read headers)
 * @param rawBody - The raw body text (from `await request.text()`)
 * @returns { valid: true } if signature is correct, or { valid: false, error } if not.
 */
export async function validateMachineSignature(
  request: Request,
  rawBody: string
): Promise<ValidationResult> {
  const apiKey = process.env.MACHINE_API_KEY;

  if (!apiKey) {
    // No API key configured — REJECT by default (security-first)
    console.error('[HMAC] MACHINE_API_KEY not set — rejecting webhook');
    return {
      valid: false,
      error: { success: false, error: 'server_misconfigured' },
    };
  }

  const receivedSignature = request.headers.get('signature-v2');

  if (!receivedSignature) {
    console.warn('[HMAC] Missing signature-v2 header');
    // Return 200 to prevent Machine from deactivating the webhook
    return {
      valid: false,
      error: { success: false, error: 'missing_signature' },
    };
  }

  try {
    // Use Web Crypto API (available in Edge Runtime, Vercel Edge, Deno, Node 18+)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiKey);
    const bodyData = encoder.encode(rawBody);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyData);

    // Convert to hex string for comparison
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Normalize: Machine may send uppercase, lowercase, or with/without prefix
    const normalizedReceived = receivedSignature.toLowerCase().trim();
    const normalizedComputed = computedHex.toLowerCase();

    if (normalizedReceived !== normalizedComputed) {
      console.warn('[HMAC] Signature mismatch', {
        received: normalizedReceived.slice(0, 16) + '...',
        computed: normalizedComputed.slice(0, 16) + '...',
      });
      return {
        valid: false,
        error: { success: false, error: 'invalid_signature' },
      };
    }

    return { valid: true };
  } catch (err) {
    console.error('[HMAC] Signature validation error:', err);
    // In case of crypto failure, reject the request
    return {
      valid: false,
      error: { success: false, error: 'signature_validation_failed' },
    };
  }
}
