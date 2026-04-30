/**
 * Email Alias Generator for White-Label Shadow Registration
 *
 * Uses Gmail's "+" alias feature to create unique emails per company
 * that all route to the same inbox.
 *
 * Example:
 *   baseEmail = "lx.leopoldo@gmail.com"
 *   empresaId = "42"
 *   result    = "lx.leopoldo+pdv_42@gmail.com"
 *
 * This allows the platform admin to:
 *   1. Receive the temporary passwords Machine sends to the "gestor"
 *   2. Filter emails by empresa_id easily
 *   3. Keep the Machine login completely hidden from the lojista
 */

/**
 * Generate a Gmail+ alias for Shadow Registration.
 *
 * @param baseEmail - The admin's real email (e.g. "nome@gmail.com")
 * @param empresaId - The Machine empresa_id (e.g. "42" or "12345")
 * @returns The alias email (e.g. "nome+pdv_42@gmail.com")
 */
export function generateWhiteLabelAlias(
  baseEmail: string,
  empresaId: string | number
): string {
  const atIndex = baseEmail.indexOf('@');
  if (atIndex === -1) {
    throw new Error(`Invalid email format: ${baseEmail}`);
  }

  const localPart = baseEmail.slice(0, atIndex);
  const domain = baseEmail.slice(atIndex + 1);

  // Sanitize empresaId — remove spaces, special chars
  const safeId = String(empresaId).replace(/[^a-zA-Z0-9_-]/g, '');

  return `${localPart}+pdv_${safeId}@${domain}`;
}

/**
 * Extract the empresa_id from an alias email.
 * Useful for debugging incoming emails.
 *
 * @param aliasEmail - e.g. "nome+pdv_42@gmail.com"
 * @returns The empresa_id (e.g. "42") or null if not a valid alias
 */
export function extractEmpresaIdFromAlias(aliasEmail: string): string | null {
  const match = aliasEmail.match(/\+pdv_([a-zA-Z0-9_-]+)@/);
  return match ? match[1] : null;
}
