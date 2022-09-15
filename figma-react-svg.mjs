#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { generate } from "./generate.mjs";

yargs(hideBin(process.argv))
  .command(
    "generate <file-id>",
    "Generate React components from Figma file",
    function (yargs) {
      return yargs
        .option("frame", {
          describe: "The Figmas frame to generate components from",
          demandOption: true,
        })
        .option("directory", {
          describe: "The path pattern to write components to",
          demandOption: true,
        })
        .option("component-name", {
          describe: "The component name pattern to use",
          demandOption: true,
        })
        .option("include", {
          describe:
            "Include components to names matching this regex, pass multiple times to include multiple",
          demandOption: true,
        })
        .array("include")
        .option("write-index", {
          describe: "Write the index.ts file after generating",
          default: true,
        })
        .boolean("write-index")
        .option("write-storybook", {
          describe: "Write Storybook stories for components after generating",
        })
        .boolean("write-storybook")
        .option("storybook-title", {
          describe: "Storybook title to use for components",
          default: "Components",
        })
        .option("storybook-grid", {
          describe: "Layout size for Storybook grid",
          default: "50px",
        })
        .option("prettier-config", {
          describe: "Path to prettier config file",
        })
        .option("concurrency", {
          describe: "Number of parallel requests to the Figma API",
          default: 10,
        })
        .number("concurrency")
        .option("delay", {
          describe: "Time in miliseconds to wait between requests",
          default: 100,
        })
        .number("delay")
        .option("rename", {
          describe:
            "Rename prop values, pass multiple times as oldValue:newValue",
        })
        .array("rename");
    },
    generate
  )
  .demandCommand(1)
  .parse();
