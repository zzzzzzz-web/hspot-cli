#!/usr/bin/env node
// Thin executable entry point. All real wiring lives in src/cli.js so the CLI
// definition stays importable/testable without executing on import.
import { run } from '../src/cli.js';

run(process.argv);
