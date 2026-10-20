/**
 * A deliberately small JSON-Schema subset, used to validate the arguments a
 * language model proposes for a capability before anything runs.
 *
 * Why not a schema library: this validator is a security boundary, and the
 * value of a boundary is that you can read all of it. It supports exactly the
 * constructs the capability catalog uses and rejects everything else, which is
 * the opposite of what a general-purpose validator optimises for.
 *
 * It also *coerces*. A model asked for a number frequently answers "3", and an
 * enum member frequently arrives with different capitalisation. Rejecting those
 * would push retry logic into every caller, so narrowing conversions that
 * cannot change meaning are done here and the coerced value is returned.
 * Anything ambiguous is an error, never a guess.
 */

const SUPPORTED_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function coerceScalar(value, type) {
  const actual = typeOf(value);
  if (type === "string") {
    if (actual === "string") return { ok: true, value };
    // Numbers and booleans have one unambiguous spelling; objects do not.
    if (actual === "number" || actual === "boolean") return { ok: true, value: String(value) };
    return { ok: false };
  }

  if (type === "number" || type === "integer") {
    let candidate = value;
    if (actual === "string") {
      const trimmed = value.trim();
      if (!trimmed || !/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
      candidate = Number(trimmed);
    } else if (actual !== "number") {
      return { ok: false };
    }
    if (!Number.isFinite(candidate)) return { ok: false };
    if (type === "integer" && !Number.isInteger(candidate)) return { ok: false };
    return { ok: true, value: candidate };
  }

  if (type === "boolean") {
    if (actual === "boolean") return { ok: true, value };
    if (actual === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1"].includes(normalized)) return { ok: true, value: true };
      if (["false", "no", "0"].includes(normalized)) return { ok: true, value: false };
    }
    return { ok: false };
  }

  return { ok: false };
}

function validateNode(schema, value, pathLabel, errors) {
  if (!schema || typeof schema !== "object") return value;

  const type = schema.type;
  if (type && !SUPPORTED_TYPES.has(type)) {
    errors.push(`${pathLabel}: unsupported schema type "${type}"`);
    return undefined;
  }

  if (value === undefined || value === null) {
    if (schema.default !== undefined) return structuredCloneSafe(schema.default);
    return undefined;
  }

  if (type === "object") {
    if (typeOf(value) !== "object") {
      errors.push(`${pathLabel}: expected an object`);
      return undefined;
    }
    return validateObject(schema, value, pathLabel, errors);
  }

  if (type === "array") {
    if (typeOf(value) !== "array") {
      errors.push(`${pathLabel}: expected an array`);
      return undefined;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${pathLabel}: at most ${schema.maxItems} items`);
      return undefined;
    }
    return value.map((entry, index) =>
      validateNode(schema.items || {}, entry, `${pathLabel}[${index}]`, errors),
    );
  }

  if (type) {
    const coerced = coerceScalar(value, type);
    if (!coerced.ok) {
      errors.push(`${pathLabel}: expected ${type}, received ${typeOf(value)}`);
      return undefined;
    }
    value = coerced.value;
  }

  if (Array.isArray(schema.enum)) {
    // Case-insensitive matching for strings only: a model that says "Codex"
    // for "codex" meant the enum member, and failing that is pure friction.
    const match = schema.enum.find((option) =>
      typeof option === "string" && typeof value === "string"
        ? option.toLowerCase() === value.toLowerCase()
        : option === value,
    );
    if (match === undefined) {
      errors.push(`${pathLabel}: must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}`);
      return undefined;
    }
    value = match;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${pathLabel}: must be at least ${schema.minLength} characters`);
      return undefined;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      // Truncating would silently change the meaning of a commit message or a
      // prompt, so this is an error rather than a clamp.
      errors.push(`${pathLabel}: must be at most ${schema.maxLength} characters`);
      return undefined;
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pathLabel}: does not match the required format`);
      return undefined;
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${pathLabel}: must be >= ${schema.minimum}`);
      return undefined;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${pathLabel}: must be <= ${schema.maximum}`);
      return undefined;
    }
  }

  return value;
}

function validateObject(schema, value, pathLabel, errors) {
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const result = {};

  for (const key of Object.keys(properties)) {
    const label = pathLabel ? `${pathLabel}.${key}` : key;
    const resolved = validateNode(properties[key], value[key], label, errors);
    if (resolved !== undefined) result[key] = resolved;
  }

  for (const key of required) {
    if (result[key] === undefined) {
      errors.push(`${pathLabel ? `${pathLabel}.` : ""}${key}: is required`);
    }
  }

  // Unknown keys are dropped rather than rejected. A model that adds a
  // hallucinated "confirm": true must not be able to smuggle it into a
  // handler, but neither should the whole call fail because it was chatty.
  return result;
}

function structuredCloneSafe(value) {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Validate `input` against a capability's parameter schema.
 * Returns `{ ok: true, value }` or `{ ok: false, errors: string[] }`.
 */
function validateParams(schema, input) {
  const errors = [];
  const root = schema && typeof schema === "object" ? schema : { type: "object", properties: {} };
  const source = input && typeOf(input) === "object" ? input : {};
  const value = validateObject(root, source, "", errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}

module.exports = { validateParams, coerceScalar };
