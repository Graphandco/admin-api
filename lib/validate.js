/**
 * Validation des paramètres pour les routes WordPress
 */

/** Valeurs autorisées pour --status des plugins WP-CLI */
const ALLOWED_PLUGIN_STATUS = ['active', 'inactive', 'must-use', 'dropin'];

/**
 * Valide le paramètre status pour plugin list.
 * @param {string} status
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePluginStatus(status) {
  if (!status) return { valid: true };
  if (typeof status !== 'string' || !ALLOWED_PLUGIN_STATUS.includes(status.trim())) {
    return {
      valid: false,
      error: `Statut invalide. Valeurs autorisées: ${ALLOWED_PLUGIN_STATUS.join(', ')}`,
    };
  }
  return { valid: true };
}

/**
 * Valide une URL pour WP-CLI --url.
 * Accepte uniquement http(s) avec caractères sûrs, max 500 chars.
 * @param {string} url
 * @returns {{ valid: boolean, error?: string }}
 */
function validateWpUrl(url) {
  if (!url || typeof url !== 'string') return { valid: false, error: 'URL requise' };
  const trimmed = url.trim();
  if (trimmed.length > 500) {
    return { valid: false, error: 'URL trop longue' };
  }
  // Format: https://domain.tld/path - pas de caractères shell dangereux
  if (!/^https?:\/\/[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._\-~:/?#[\]@!$&'()*+,;=%]*)?$/i.test(trimmed)) {
    return { valid: false, error: 'Format d\'URL invalide' };
  }
  // Interdire caractères dangereux pour injection shell (backtick, semi-colon, pipe, backslash, newline)
  if (/[`;|\\\x00-\x1f]/.test(trimmed)) {
    return { valid: false, error: 'URL contient des caractères non autorisés' };
  }
  return { valid: true };
}

module.exports = { validatePluginStatus, validateWpUrl, ALLOWED_PLUGIN_STATUS };
