/**
 * Parser module barrel exports.
 *
 * Re-exports all public classes, types, and interfaces from the
 * EDF parser, ResMed interpreter, session builder, and validator.
 */

// EDF Parser
export { EDFParser } from './edf/EDFParser';
export type {
  ValidationResult as EDFValidationResult,
  ValidationIssue as EDFValidationIssue,
} from './edf/EDFParser';

// EDF types
export type { EDFAnnotation, EDFFile, EDFHeader, EDFSignal } from './edf/types';

// EDF errors
export { EDFParseError } from './edf/errors';
export type { EDFParseErrorCode, EDFParseErrorContext } from './edf/errors';

// ResMed Interpreter
export { ResMedInterpreter } from './resmed/ResMedInterpreter';
export type {
  MachineCapabilities,
  MachineInfo,
  ResMedInterpretation,
  StandardChannel,
  StandardEvent,
} from './resmed/ResMedInterpreter';

// Session Builder
export { SessionBuilder } from './resmed/SessionBuilder';
export type { BuildResult } from './resmed/SessionBuilder';

// Validator
export { Validator } from './validation/Validator';
export type { ValidationIssue, ValidationResult } from './validation/Validator';
