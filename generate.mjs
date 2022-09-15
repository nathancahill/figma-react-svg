import fs from "fs/promises";
import path from "path";
import { transform } from "@svgr/core";
import prettier from "prettier";
import Queue from "async-await-queue";
import cliProgress from "cli-progress";
import _ from "lodash";
import * as api from "./api.mjs";

export const generate = async (argv) => {
  const {
    fileId,
    frame,
    directory,
    componentName,
    include,
    writeIndex,
    writeStorybook,
    storybookTitle,
    storybookGrid,
    prettierConfig,
    currentColor,
    concurrency,
    delay,
    rename,
  } = argv;

  if (!process.env.FIGMA_ACCESS_TOKEN) {
    throw new Error(
      "Missing Figma access token. Set FIGMA_ACCESS_TOKEN in the env."
    );
  }

  const resolvedPrettierConfig = prettierConfig
    ? prettierConfig
    : await prettier.resolveConfigFile(process.cwd());

  if (resolvedPrettierConfig) {
    console.info("Using prettier config: ", resolvedPrettierConfig);
  }

  const prettierOptions = resolvedPrettierConfig
    ? await prettier.resolveConfig(process.cwd(), {
        config: resolvedPrettierConfig,
      })
    : {};

  console.info("Fetching Figma file...");
  const iconNodes = await api.getNodeChildren(fileId, frame);

  const renameMap = rename.reduce((acc, rename) => {
    const [oldValue, newValue] = rename.split(":");
    acc[oldValue] = newValue;
    return acc;
  }, {});

  const filteredNodes = iconNodes
    .filter((node) => {
      const name = node.name;
      return include.some((pattern) => name.match(pattern));
    })
    .map(parseNodeVariants(include, renameMap));

  console.info(`Found ${filteredNodes.length} matching icons.`);

  const processQueue = new Queue(concurrency, delay);
  const promises = [];
  const progress = new cliProgress.SingleBar({
    format:
      "Generating [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} icons",
  });
  progress.start(filteredNodes.length, 0);

  for (const node of filteredNodes) {
    const key = Symbol();

    promises.push(
      processQueue
        .wait(key)
        .then(() =>
          generateFile(
            fileId,
            node,
            directory,
            componentName,
            currentColor,
            prettierOptions
          )
        )
        .catch((e) => console.error(e))
        .finally(() => {
          progress.increment();
          processQueue.end(key);
        })
    );
  }

  const result = await Promise.all(promises);
  progress.stop();

  const successful = result.filter((r) => r);

  const successCount = successful.length;
  const failureCount = result.length - successCount;

  console.info(`✅ Generated ${successCount} icons.`);

  if (failureCount > 0) {
    console.info(`❌ ${failureCount} failed to download.`);
  }

  if (writeIndex) {
    const indexFile = successful
      .map(
        (r) =>
          `export { ${r.componentName} } from "./${_.kebabCase(
            r.componentName
          )}";`
      )
      .join("\n");

    const indexFilePath = path.join(directory, "index.ts");
    const formatted = prettier.format(indexFile, {
      filepath: indexFilePath,
      ...prettierOptions,
    });

    await createAndWrite(indexFilePath, formatted);
  }

  if (writeStorybook) {
    let storybookFile = `import React from 'react';\n`;
    storybookFile += successful
      .map(
        (r) =>
          `import { ${r.componentName} } from "../${_.kebabCase(
            r.componentName
          )}";`
      )
      .join("\n");

    storybookFile += `\n\nexport const Icons = () => (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(${storybookGrid}, 1fr))',
            gridAutoRows: '${storybookGrid}',
        }}>
          ${successful
            .map((r) => {
              return r.propVariants
                .map((propVariant) => `<${r.componentName} ${propVariant} />`)
                .join("\n");
            })
            .join("\n")}
        </div>
    );

    export default {
        title: "${storybookTitle}",
    };`;

    const storybookFilePath = path.join(
      directory,
      "__stories__",
      "icons.stories.tsx"
    );
    const formatted = prettier.format(storybookFile, {
      filepath: storybookFilePath,
      ...prettierOptions,
    });

    await createAndWrite(
      path.join(directory, "__stories__", "icons.stories.tsx"),
      formatted
    );
  }

  console.info(successful.map((r) => r.filepath).join("\n"));
};

const generateFile = async (
  fileId,
  node,
  directory,
  componentName,
  currentColor,
  prettierOptions
) => {
  const component = componentName.replace(
    /{(?<key>[a-zA-Z]+)}/g,
    (_match, key) => node.matches[key].replace(/[^a-zA-Z]/g, "")
  );

  const filename = `${_.kebabCase(component)}.tsx`;
  const filepath = path
    .join(directory, filename)
    .replace(/{(?<key>[a-zA-Z]+)}/g, (_match, key) =>
      node.matches[key].replace(/[^a-zA-Z]/g, "")
    );

  const { file, propVariants } = await generateIconFileContent(
    fileId,
    node,
    component
  );

  const fileWithCurrentColor = currentColor
    ? file
        .replaceAll(`stroke="${currentColor}"`, `stroke="currentColor"`)
        .replaceAll(`fill="${currentColor}"`, `fill="currentColor"`)
    : file;

  const formatted = prettier.format(fileWithCurrentColor, {
    filepath,
    ...prettierOptions,
  });

  await createAndWrite(filepath, formatted);

  return {
    componentName: component,
    propVariants,
    filename,
    filepath,
  };
};

const generateIconFileContent = async (fileId, node, componentName) => {
  let componentInterface = `import React from 'react';\n\nexport interface ${componentName}Props {\n`;

  const componentProps = Object.keys(node.variantProperties);

  for (const componentProp of componentProps) {
    const variants = node.variantProperties[componentProp].map((variant) =>
      isBoolean(variant) ? variant : `"${variant}"`
    );

    if (variants)
      if (variants.every((variant) => isBoolean(variant))) {
        componentInterface += `    ${componentProp}?: boolean;\n`;
      } else {
        componentInterface += `    ${componentProp}: ${variants.join(
          " | "
        )};\n`;
      }
  }

  componentInterface += `}\n\n`;

  let component = `${componentInterface}export const ${componentName}: React.FC<${componentName}Props> = ({ ${componentProps.join(
    ", "
  )}, ...props }) => {\n`;

  const variantNodeIds = node.variantNodes.map((variantNode) => variantNode.id);
  const svgUrls = await api.getSvgImageUrls(fileId, variantNodeIds);

  const propVariants = [];

  for (const variantNode of node.variantNodes) {
    const variantIfStatement = variantNode.properties
      .map((p) => {
        const prop = Object.keys(p)[0];

        if (isBoolean(p[prop])) {
          if (p[prop]) {
            return `${prop}`;
          } else {
            return `!${prop}`;
          }
        } else {
          return `${prop} === "${p[prop]}"`;
        }
      })
      .join(" && ");

    const variantProps = variantNode.properties
      .map((p) => {
        const prop = Object.keys(p)[0];

        if (isBoolean(p[prop])) {
          if (p[prop]) {
            return `${prop}`;
          } else {
            return ``;
          }
        } else {
          return `${prop}="${p[prop]}"`;
        }
      })
      .join(" ");

    propVariants.push(variantProps);

    component += `    if (${variantIfStatement}) {\n`;

    const iconJsx = await fetchSvg(svgUrls[variantNode.id]);

    component += `        return (\n`;
    component += iconJsx;
    component += `        );\n`;
    component += `    }\n\n`;
  }

  component += `    return null;\n`;
  component += `};\n`;

  return {
    file: component,
    propVariants,
  };
};

const fetchSvg = async (iconUrl) => {
  const { data: svgContent } = await api.getImageContent(iconUrl);

  const jsCode = await transform(
    svgContent,
    {
      plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
      template: (variables) => variables.jsx,
    },
    { componentName: "Icon" }
  );

  return jsCode;
};

const parseNodeVariants = (include, renameMap) => (node) => {
  const variantNodes = node.children.map((variant) => {
    return {
      ...variant,
      properties: variant.name.includes("=")
        ? variant.name.split(", ").map((p) => {
            const [key, value] = p.split("=");
            const keyLower = key.charAt(0).toLowerCase() + key.slice(1);

            let renamedValue = renameMap[value] || value;

            if (renamedValue === "true") {
              renamedValue = true;
            } else if (renamedValue === "false") {
              renamedValue = false;
            }

            return { [keyLower]: renamedValue };
          })
        : [],
    };
  });

  const variantProperties = variantNodes.reduce((acc, variant) => {
    variant["properties"].forEach((p) => {
      const key = Object.keys(p)[0];

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(p[key]);
    });

    return acc;
  }, {});

  Object.keys(variantProperties).map((key) => {
    variantProperties[key] = [...new Set(variantProperties[key])];
  });

  const matches = node.name.match(
    include.filter((pattern) => node.name.match(pattern))[0]
  ).groups;

  return {
    ...node,
    variantProperties,
    variantNodes,
    matches,
    name: matches.name
      ? matches.name.replace(/[^a-zA-Z]/g, "")
      : node.name.replace(/[^a-zA-Z]/g, ""),
  };
};

const isExists = async (path) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const createAndWrite = async (filepath, content) => {
  const dirname = path.dirname(filepath);
  const exist = await isExists(dirname);
  if (!exist) {
    await fs.mkdir(dirname, { recursive: true });
  }

  await fs.writeFile(filepath, content, "utf8");
};

const isBoolean = (value) => {
  return value === true || value === false;
};
