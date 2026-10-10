import { mechanicsContext } from '../mechanics.ts';

/** One authoritative, source-derived public manual shared with the runner. */
export const MECHANICS_CONTEXT = mechanicsContext();
export const MECHANICS_VERSION = MECHANICS_CONTEXT.version;
export const MECHANICS_TEXT = MECHANICS_CONTEXT.text;
export const MECHANICS_SHA256 = MECHANICS_CONTEXT.sha256;
