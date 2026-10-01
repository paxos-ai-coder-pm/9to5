#!/usr/bin/env node
// Stands in for Explorer / Finder / xdg-open in tests: records which folder the office asked to open.
import fs from "node:fs";
fs.appendFileSync(`${process.env.FAKE_LOG}.opener`, `${process.argv[2]}\n`);
